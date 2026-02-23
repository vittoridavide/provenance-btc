use provenance_core::model::tx_view::{
    calculate_fee_sat, calculate_feerate_sat_vb, TxInpView, TxOutView,
};

fn mk_input(value_sat: Option<u64>, is_coinbase: bool) -> TxInpView {
    TxInpView {
        vin: 0,
        prev_txid: String::new(),
        prev_vout: 0,
        value_sat,
        script_pubkey_hex: String::new(),
        script_type: None,
        script_sig_hex: String::new(),
        witness_items_count: 0,
        witness_hex: vec![],
        is_coinbase,
    }
}

fn mk_output(value_sat: u64) -> TxOutView {
    TxOutView {
        vout: 0,
        value_sat,
        script_pubkey_hex: String::new(),
        script_type: None,
        address: None,
    }
}

#[test]
fn calculates_fee_and_feerate_when_inputs_are_known() {
    let inputs = vec![mk_input(Some(60_000), false), mk_input(Some(40_000), false)];
    let outputs = vec![mk_output(90_000)];

    let fee_sat = calculate_fee_sat(false, &inputs, &outputs);
    let feerate = calculate_feerate_sat_vb(fee_sat, 200);

    assert_eq!(fee_sat, Some(10_000));
    assert_eq!(feerate, Some(50.0));
}

#[test]
fn coinbase_tx_has_no_fee_or_feerate() {
    let inputs = vec![mk_input(None, true)];
    let outputs = vec![mk_output(500_000_000)];

    let fee_sat = calculate_fee_sat(true, &inputs, &outputs);
    let feerate = calculate_feerate_sat_vb(fee_sat, 100);

    assert_eq!(fee_sat, None);
    assert_eq!(feerate, None);
}

#[test]
fn missing_parent_input_value_disables_fee_and_feerate() {
    let inputs = vec![mk_input(Some(30_000), false), mk_input(None, false)];
    let outputs = vec![mk_output(20_000)];

    let fee_sat = calculate_fee_sat(false, &inputs, &outputs);
    let feerate = calculate_feerate_sat_vb(fee_sat, 100);

    assert_eq!(fee_sat, None);
    assert_eq!(feerate, None);
}

#[test]
fn fee_is_none_when_outputs_exceed_inputs() {
    let inputs = vec![mk_input(Some(10_000), false)];
    let outputs = vec![mk_output(10_001)];

    let fee_sat = calculate_fee_sat(false, &inputs, &outputs);
    let feerate = calculate_feerate_sat_vb(fee_sat, 100);

    assert_eq!(fee_sat, None);
    assert_eq!(feerate, None);
}
