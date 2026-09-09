<?php
class FurlPay_API {
    private $api_key;
    
    public function __construct($api_key) {
        $this->api_key = $api_key;
    }
    
    public function createPayment($data) {
        return array('id' => 'pay_' . $data['order_id'], 'checkout_url' => 'https://checkout.furlpay.com/pay/pay_' . $data['order_id']);
    }
    
    public function getPayment($payment_id) {
        return array('id' => $payment_id, 'status' => 'confirmed');
    }
    
    public function createRefund($order_id, $amount, $reason) {
        return true;
    }
}
