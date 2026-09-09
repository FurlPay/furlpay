<?php
namespace FurlPay\Payment\Controller\Payment;

use Magento\Framework\App\Action\Action;
use Magento\Framework\App\Action\Context;
use Magento\Checkout\Model\Session;
use FurlPay\Payment\Model\FurlPayClient;

class Redirect extends Action
{
    protected $checkoutSession;
    protected $furlPayClient;

    public function __construct(
        Context $context,
        Session $checkoutSession,
        FurlPayClient $furlPayClient
    ) {
        parent::__construct($context);
        $this->checkoutSession = $checkoutSession;
        $this->furlPayClient = $furlPayClient;
    }

    public function execute()
    {
        $order = $this->checkoutSession->getLastRealOrder();
        if (!$order->getId()) {
            $this->_redirect('checkout/cart');
            return;
        }

        try {
            $response = $this->furlPayClient->createPayment(
                $order->getGrandTotal(),
                $order->getIncrementId(),
                $order->getOrderCurrencyCode()
            );

            if (isset($response['paymentUrl'])) {
                $this->_redirect($response['paymentUrl']);
            } else {
                throw new \Exception('Invalid FurlPay response');
            }
        } catch (\Exception $e) {
            $this->messageManager->addErrorMessage(__('Error initiating FurlPay payment.'));
            $this->_redirect('checkout/cart');
        }
    }
}
