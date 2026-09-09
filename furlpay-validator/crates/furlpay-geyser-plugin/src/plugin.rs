use solana_geyser_plugin_interface::geyser_plugin_interface::{GeyserPlugin, GeyserPluginError, Result as PluginResult};
use solana_sdk::signature::Signature;
use furlpay_common::types::PaymentTransaction;

#[derive(Debug, Default)]
pub struct FurlPayGeyserPlugin;

impl GeyserPlugin for FurlPayGeyserPlugin {
    fn name(&self) -> &'static str {
        "furlpay-geyser-plugin"
    }

    fn on_load(&mut self, config_file: &str, _is_reload: bool) -> PluginResult<()> {
        println!("Loaded FurlPay geyser plugin from config: {}", config_file);
        Ok(())
    }

    fn on_unload(&mut self) {}

    fn update_account(
        &self,
        account: solana_geyser_plugin_interface::geyser_plugin_interface::ReplicaAccountInfoVersions,
        slot: u64,
        is_startup: bool,
    ) -> PluginResult<()> {
        Ok(())
    }

    fn notify_transaction(
        &self,
        transaction: solana_geyser_plugin_interface::geyser_plugin_interface::ReplicaTransactionInfoVersions,
        slot: u64,
    ) -> PluginResult<()> {
        // Mock notification logic
        Ok(())
    }

    fn notify_block_metadata(
        &self,
        blockinfo: solana_geyser_plugin_interface::geyser_plugin_interface::ReplicaBlockInfoVersions,
    ) -> PluginResult<()> {
        Ok(())
    }

    fn account_data_notifications_enabled(&self) -> bool { true }
    fn transaction_notifications_enabled(&self) -> bool { true }
}

#[no_mangle]
#[allow(improper_ctypes_definitions)]
pub unsafe extern "C" fn _create_plugin() -> *mut dyn GeyserPlugin {
    let plugin = FurlPayGeyserPlugin::default();
    let plugin: Box<dyn GeyserPlugin> = Box::new(plugin);
    Box::into_raw(plugin)
}
