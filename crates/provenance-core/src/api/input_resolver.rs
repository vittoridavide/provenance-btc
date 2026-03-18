use std::collections::BTreeSet;

use crate::api::types::{
    GraphInputCandidateRoot, GraphInputKind, GraphInputRequest, GraphInputResolution,
};
use crate::model::input_target::{parse_input_target, InputTarget};
use crate::rpc::client::{AddressUtxoCandidate, CoreRpc};
use crate::{CoreError, Result};

pub trait InputResolverProvider {
    fn scan_address_utxos(&self, address: &str) -> Result<Vec<AddressUtxoCandidate>>;
}

impl InputResolverProvider for CoreRpc {
    fn scan_address_utxos(&self, address: &str) -> Result<Vec<AddressUtxoCandidate>> {
        self.scan_address_utxos(address)
    }
}

pub fn resolve_graph_input<P: InputResolverProvider>(
    provider: &P,
    request: &GraphInputRequest,
) -> Result<GraphInputResolution> {
    let parsed = parse_input_target(&request.input)?;

    match parsed {
        InputTarget::Txid(txid) => {
            let selected_root_txid = normalize_or_match_selected_root(
                request.selected_root_txid.as_deref(),
                &txid,
                "txid input",
            )?;
            Ok(GraphInputResolution {
                normalized_input: txid.clone(),
                input_kind: GraphInputKind::Txid,
                candidate_roots: vec![GraphInputCandidateRoot {
                    txid,
                    vout: None,
                    amount_sat: None,
                    height: None,
                }],
                selected_root_txid: Some(selected_root_txid),
                requires_selection: false,
            })
        }
        InputTarget::Outpoint { txid, vout } => {
            let selected_root_txid = normalize_or_match_selected_root(
                request.selected_root_txid.as_deref(),
                &txid,
                "outpoint input",
            )?;
            Ok(GraphInputResolution {
                normalized_input: format!("{txid}:{vout}"),
                input_kind: GraphInputKind::Outpoint,
                candidate_roots: vec![GraphInputCandidateRoot {
                    txid,
                    vout: Some(vout),
                    amount_sat: None,
                    height: None,
                }],
                selected_root_txid: Some(selected_root_txid),
                requires_selection: false,
            })
        }
        InputTarget::Address(address) => {
            let candidates = provider.scan_address_utxos(&address)?;
            if candidates.is_empty() {
                return Err(CoreError::Other(format!(
                    "no unspent outputs found for address '{address}' (MVP address lookup is UTXO-set only via scantxoutset)"
                )));
            }

            let candidate_roots = candidates
                .into_iter()
                .map(|candidate| GraphInputCandidateRoot {
                    txid: candidate.txid,
                    vout: Some(candidate.vout),
                    amount_sat: Some(candidate.amount_sat),
                    height: candidate.height,
                })
                .collect::<Vec<_>>();

            let candidate_txids = candidate_roots
                .iter()
                .map(|candidate| candidate.txid.clone())
                .collect::<BTreeSet<_>>();

            let (selected_root_txid, requires_selection) = resolve_address_selected_root(
                &candidate_txids,
                request.selected_root_txid.as_deref(),
            )?;

            Ok(GraphInputResolution {
                normalized_input: address,
                input_kind: GraphInputKind::Address,
                candidate_roots,
                selected_root_txid,
                requires_selection,
            })
        }
    }
}

fn normalize_or_match_selected_root(
    selected_root_txid: Option<&str>,
    resolved_root_txid: &str,
    input_kind: &str,
) -> Result<String> {
    match selected_root_txid {
        None => Ok(resolved_root_txid.to_string()),
        Some(raw_selected) => {
            let selected = normalize_selected_root_txid(raw_selected)?;
            if selected != resolved_root_txid {
                return Err(CoreError::Other(format!(
                    "selected_root_txid '{selected}' does not match resolved root '{resolved_root_txid}' for {input_kind}"
                )));
            }
            Ok(selected)
        }
    }
}

fn resolve_address_selected_root(
    candidate_txids: &BTreeSet<String>,
    selected_root_txid: Option<&str>,
) -> Result<(Option<String>, bool)> {
    if let Some(raw_selected) = selected_root_txid {
        let selected = normalize_selected_root_txid(raw_selected)?;
        if !candidate_txids.contains(&selected) {
            return Err(CoreError::Other(format!(
                "selected_root_txid '{selected}' is not present in address candidates"
            )));
        }
        return Ok((Some(selected), false));
    }

    if candidate_txids.len() == 1 {
        return Ok((candidate_txids.iter().next().cloned(), false));
    }

    Ok((None, true))
}

fn normalize_selected_root_txid(raw_selected: &str) -> Result<String> {
    match parse_input_target(raw_selected)? {
        InputTarget::Txid(txid) => Ok(txid),
        InputTarget::Outpoint { .. } => Err(CoreError::Other(format!(
            "selected_root_txid must be a txid, received outpoint '{raw_selected}'"
        ))),
        InputTarget::Address(_) => Err(CoreError::Other(format!(
            "selected_root_txid must be a txid, received address '{raw_selected}'"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::api::types::GraphInputRequest;
    use crate::rpc::client::AddressUtxoCandidate;

    use super::{resolve_graph_input, InputResolverProvider, Result};

    const TXID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TXID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const ADDRESS: &str = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";

    struct FakeResolverProvider {
        candidates_by_address: HashMap<String, Vec<AddressUtxoCandidate>>,
        fail_with: Option<String>,
    }

    impl InputResolverProvider for FakeResolverProvider {
        fn scan_address_utxos(&self, address: &str) -> Result<Vec<AddressUtxoCandidate>> {
            if let Some(message) = &self.fail_with {
                return Err(crate::CoreError::Rpc(message.clone()));
            }

            Ok(self
                .candidates_by_address
                .get(address)
                .cloned()
                .unwrap_or_default())
        }
    }

    #[test]
    fn resolve_txid_selects_single_root() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::new(),
            fail_with: None,
        };
        let request = GraphInputRequest {
            input: TXID_A.to_uppercase(),
            traversal_depth: 2,
            selected_root_txid: None,
        };

        let resolved = resolve_graph_input(&provider, &request).expect("txid resolves");

        assert_eq!(resolved.normalized_input, TXID_A);
        assert_eq!(resolved.selected_root_txid.as_deref(), Some(TXID_A));
        assert!(!resolved.requires_selection);
        assert_eq!(resolved.candidate_roots.len(), 1);
        assert_eq!(resolved.candidate_roots[0].txid, TXID_A);
    }

    #[test]
    fn resolve_outpoint_preserves_vout_metadata() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::new(),
            fail_with: None,
        };
        let request = GraphInputRequest {
            input: format!("{TXID_A}:7"),
            traversal_depth: 2,
            selected_root_txid: None,
        };

        let resolved = resolve_graph_input(&provider, &request).expect("outpoint resolves");

        assert_eq!(resolved.selected_root_txid.as_deref(), Some(TXID_A));
        assert_eq!(resolved.candidate_roots[0].vout, Some(7));
    }

    #[test]
    fn resolve_address_requires_selection_for_multiple_candidate_txids() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::from([(
                ADDRESS.to_string(),
                vec![
                    candidate(TXID_A, 0, 1, Some(100)),
                    candidate(TXID_B, 1, 2, Some(90)),
                ],
            )]),
            fail_with: None,
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 1,
            selected_root_txid: None,
        };

        let resolved = resolve_graph_input(&provider, &request).expect("address resolves");

        assert!(resolved.requires_selection);
        assert!(resolved.selected_root_txid.is_none());
        assert_eq!(
            resolved
                .candidate_roots
                .iter()
                .map(|candidate| candidate.txid.as_str())
                .collect::<Vec<_>>(),
            vec![TXID_A, TXID_B]
        );
    }

    #[test]
    fn resolve_address_auto_selects_unique_candidate_txid() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::from([(
                ADDRESS.to_string(),
                vec![
                    candidate(TXID_A, 0, 1, Some(100)),
                    candidate(TXID_A, 1, 2, Some(100)),
                ],
            )]),
            fail_with: None,
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 1,
            selected_root_txid: None,
        };

        let resolved = resolve_graph_input(&provider, &request).expect("address resolves");

        assert!(!resolved.requires_selection);
        assert_eq!(resolved.selected_root_txid.as_deref(), Some(TXID_A));
    }

    #[test]
    fn resolve_address_validates_selected_root_membership() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::from([(
                ADDRESS.to_string(),
                vec![candidate(TXID_A, 0, 1, Some(100))],
            )]),
            fail_with: None,
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 1,
            selected_root_txid: Some(TXID_B.to_string()),
        };

        let err = resolve_graph_input(&provider, &request).expect_err("selected root should fail");
        assert!(err
            .to_string()
            .contains("is not present in address candidates"));
    }

    #[test]
    fn resolve_address_reports_no_match_with_utxo_only_context() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::new(),
            fail_with: None,
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 1,
            selected_root_txid: None,
        };

        let err = resolve_graph_input(&provider, &request).expect_err("no match should fail");
        assert!(err.to_string().contains("UTXO-set only"));
    }

    #[test]
    fn resolve_address_propagates_rpc_failures() {
        let provider = FakeResolverProvider {
            candidates_by_address: HashMap::new(),
            fail_with: Some("rpc unavailable".to_string()),
        };
        let request = GraphInputRequest {
            input: ADDRESS.to_string(),
            traversal_depth: 1,
            selected_root_txid: None,
        };

        let err = resolve_graph_input(&provider, &request).expect_err("rpc failure should bubble");
        assert!(err.to_string().contains("rpc unavailable"));
    }

    fn candidate(
        txid: &str,
        vout: u32,
        amount_sat: u64,
        height: Option<u32>,
    ) -> AddressUtxoCandidate {
        AddressUtxoCandidate {
            txid: txid.to_string(),
            vout,
            amount_sat,
            height,
        }
    }
}
