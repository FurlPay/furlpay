<?php
class WC_FurlPay_Gateway extends WC_Payment_Gateway {
    public function __construct() {
        $this->id = 'furlpay';
        $this->icon = '';
        $this->has_fields = false;
        $this->method_title = 'FurlPay';
        $this->method_description = 'Accept Solana stablecoin payments.';
        $this->supports = array('products', 'refunds');

        $this->init_form_fields();
        $this->init_settings();

        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->api_key = $this->get_option('api_key');
        
        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
    }

    public function init_form_fields() {
        $this->form_fields = array(
            'enabled' => array('title' => 'Enable/Disable', 'type' => 'checkbox', 'label' => 'Enable FurlPay', 'default' => 'yes'),
            'title' => array('title' => 'Title', 'type' => 'text', 'default' => 'FurlPay'),
            'description' => array('title' => 'Description', 'type' => 'textarea', 'default' => 'Pay with Solana stablecoins.'),
            'api_key' => array('title' => 'API Key', 'type' => 'password'),
            'environment' => array('title' => 'Environment', 'type' => 'select', 'options' => array('test' => 'Test', 'live' => 'Live')),
            'settlement_tier' => array('title' => 'Settlement Tier', 'type' => 'select', 'options' => array('instant' => 'Instant', 'daily' => 'Daily')),
            'accepted_currencies' => array('title' => 'Accepted Currencies', 'type' => 'text', 'default' => 'USDC,USDT')
        );
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        $api = new FurlPay_API($this->api_key);
        
        $payment = $api->createPayment(array(
            'amount' => $order->get_total(),
            'currency' => $order->get_currency(),
            'order_id' => $order_id
        ));

        if (isset($payment['checkout_url'])) {
            return array('result' => 'success', 'redirect' => $payment['checkout_url']);
        }
        return array('result' => 'fail');
    }

    public function process_refund($order_id, $amount = null, $reason = '') {
        $order = wc_get_order($order_id);
        $api = new FurlPay_API($this->api_key);
        
        return $api->createRefund($order_id, $amount, $reason);
    }
}
