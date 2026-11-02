use serde_json::{Value, json};

pub(crate) fn apply(address: &str, keep: bool, labels: Value, mut call: impl FnMut(&str, Value) -> anyhow::Result<Value>) -> Result<(), String> {
    let before = call("terminal.get", json!({"terminal":address})).map_err(|e| format!("{e:#}"))?;
    let old_keep = before["keep"].as_bool().ok_or("terminal record has no keep state")?;
    let old_labels: serde_json::Map<String, Value> = labels.as_object().unwrap().keys()
        .map(|k| (k.clone(), before["labels"].get(k).cloned().unwrap_or(json!("")))).collect();
    let result = (|| {
        call("terminal.keep", json!({"terminal":address,"keep":keep}))?;
        call("terminal.label", json!({"terminal":address,"labels":labels}))?;
        anyhow::Ok(())
    })();
    if let Err(error) = result {
        // shortcut: separate core RPCs need compensation; use an atomic method if core adds one.
        let mut failures = Vec::new();
        for (method, args) in [
            ("terminal.keep", json!({"terminal":address,"keep":old_keep})),
            ("terminal.label", json!({"terminal":address,"labels":old_labels})),
        ] {
            if let Err(e) = call(method, args) { failures.push(format!("{method}: {e:#}")); }
        }
        return Err(if failures.is_empty() { format!("{error:#}; previous terminal metadata restored") }
            else { format!("{error:#}; metadata recovery also failed ({}). Check core get {address} before retrying.", failures.join("; ")) });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_failure_restores_keep_and_placement_in_both_directions() {
        for detached in [true, false] {
            for applied_before_error in [true, false] {
                let before = if detached { json!({"keep":false,"labels":{"rove.detached":"1","user":"keep"}}) }
                    else { json!({"keep":true,"labels":{"herdr.space":"sp1","herdr.tab":"tb1","user":"keep"}}) };
                let mut record = before.clone();
                let labels = if detached { json!({"herdr.space":"sp2","herdr.tab":"tb2","rove.detached":""}) }
                    else { json!({"herdr.space":"","herdr.tab":"","rove.detached":"1"}) };
                let mut first_label = true;
                let result = apply("box/t1", detached, labels, |method, args| {
                    match method {
                        "terminal.get" => return Ok(record.clone()),
                        "terminal.keep" => record["keep"] = args["keep"].clone(),
                        "terminal.label" => {
                            let fail = std::mem::replace(&mut first_label, false);
                            if !fail || applied_before_error {
                                for (k, v) in args["labels"].as_object().unwrap() {
                                    if v == "" { record["labels"].as_object_mut().unwrap().remove(k); }
                                    else { record["labels"][k] = v.clone(); }
                                }
                            }
                            if fail { anyhow::bail!("injected label failure"); }
                        }
                        _ => panic!("unexpected method {method}"),
                    }
                    Ok(json!({}))
                });
                assert!(result.is_err());
                assert_eq!(record, before, "detached={detached}, applied_before_error={applied_before_error}");
            }
        }
    }

    #[test]
    fn failed_recovery_is_reported_and_does_not_skip_the_other_restore() {
        let mut methods = Vec::new();
        let result = apply("t1", true, json!({"rove.detached":""}), |method, _| {
            methods.push(method.to_owned());
            if method == "terminal.get" { return Ok(json!({"keep":false,"labels":{"rove.detached":"1"}})); }
            if methods.len() == 3 || methods.len() == 4 { anyhow::bail!("offline"); }
            Ok(json!({}))
        });
        assert!(result.unwrap_err().contains("metadata recovery also failed"));
        assert_eq!(methods, ["terminal.get", "terminal.keep", "terminal.label", "terminal.keep", "terminal.label"]);
    }
}
