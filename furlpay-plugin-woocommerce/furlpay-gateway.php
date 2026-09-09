<?php
/**
 * Plugin Name: FurlPay Gateway
 * Description: FurlPay payment gateway for WooCommerce
 * Version: 0.1.0
 * Author: FurlPay
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('plugins_loaded', 'init_furlpay_gateway_class');
function init_furlpay_gateway_class() {
    if (!class_exists('WC_Payment_Gateway')) return;

    include_once dirname(__FILE__) . '/includes/class-furlpay-gateway.php';
    include_once dirname(__FILE__) . '/includes/class-furlpay-api.php';
    include_once dirname(__FILE__) . '/includes/class-furlpay-webhook.php';

    add_filter('woocommerce_payment_gateways', 'add_furlpay_gateway_class');
    function add_furlpay_gateway_class($methods) {
        $methods[] = 'WC_FurlPay_Gateway';
        return $methods;
    }
}
