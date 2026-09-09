use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct RpcResponse<T> {
    pub data: T,
}
