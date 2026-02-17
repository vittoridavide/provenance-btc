use serde_json::Value;

pub fn parse_indexinfo(v: &Value) -> (Option<bool>, Option<bool>, Option<bool>) {
    let tx = v
        .get("txindex")
        .and_then(|x| x.get("synced"))
        .and_then(|b| b.as_bool());
    let cs = v
        .get("coinstatsindex")
        .and_then(|x| x.get("synced"))
        .and_then(|b| b.as_bool());

    // commonly keyed by "basic" (BIP157)
    let bf = v
        .get("basic")
        .and_then(|x| x.get("synced"))
        .and_then(|b| b.as_bool())
        .or_else(|| {
            v.get("blockfilterindex")
                .and_then(|x| x.get("synced"))
                .and_then(|b| b.as_bool())
        });

    (tx, cs, bf)
}
