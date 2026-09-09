use serde::Deserialize;

#[derive(Deserialize)]
pub struct GeyserConfig {
    pub enable_metrics: bool,
}
