<?php
namespace FurlPay\Payment\Model;

class FurlPayClient
{
    protected $config;
    
    public function __construct(\Magento\Framework\App\Config\ScopeConfigInterface $config)
    {
        $this->config = $config;
    }

    public function createPayment($amount, $orderId, $currency)
    {
        $apiKey = $this->config->getValue('payment/furlpay/api_key');
        
        $payload = json_encode([
            'amount' => $amount,
            'currency' => $currency,
            'orderId' => $orderId
        ]);

        $ch = curl_init('https://api.furlpay.com/v1/payments');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            throw new \Exception('Failed to create FurlPay payment');
        }

        return json_decode($response, true);
    }

    public function verifyWebhookSignature($payload, $signature)
    {
        $webhookSecret = $this->config->getValue('payment/furlpay/webhook_secret');
        $expectedSignature = hash_hmac('sha256', $payload, $webhookSecret);
        
        return hash_equals($expectedSignature, $signature);
    }
}
