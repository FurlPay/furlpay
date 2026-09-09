<?php
class FurlPay_Webhook {
    public static function verifySignature($payload, $signature, $secret) {
        $expected = hash_hmac('sha256', $payload, $secret);
        return hash_equals($expected, $signature);
    }
    
    public static function handle() {
        $payload = file_get_contents('php://input');
        $signature = $_SERVER['HTTP_X_FURLPAY_SIGNATURE'] ?? '';
        $secret = get_option('furlpay_webhook_secret', '');
        
        if (!self::verifySignature($payload, $signature, $secret)) {
            wp_die('Unauthorized', 'Webhook Error', 401);
        }
        
        $event = json_decode($payload, true);
        
        if ($event && isset($event['order_id'])) {
            $order = wc_get_order($event['order_id']);
            if ($order) {
                if ($event['status'] === 'confirmed') {
                    $order->payment_complete();
                } else if ($event['status'] === 'failed') {
                    $order->update_status('failed', 'FurlPay payment failed.');
                }
            }
        }
        
        wp_send_json_success();
    }
}
add_action('woocommerce_api_furlpay_webhook', array('FurlPay_Webhook', 'handle'));
