use std::{env, error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: zipship-openapi <output.json>")?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let document = zipship_api::openapi_document();
    let mut json = serde_json::to_string_pretty(&document)?;
    json.push('\n');
    fs::write(output, json)?;
    Ok(())
}
