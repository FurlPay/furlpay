<?php
namespace FurlPay\Payment\Controller\Webhook;

use Magento\Framework\App\Action\Action;
use Magento\Framework\App\Action\Context;
use Magento\Framework\App\CsrfAwareActionInterface;
use Magento\Framework\App\Request\InvalidRequestException;
use Magento\Framework\App\RequestInterface;
use FurlPay\Payment\Model\FurlPayClient;

class Receive extends Action implements CsrfAwareActionInterface
{
    protected $furlPayClient;
    protected $orderFactory;

    public function __construct(
        Context $context,
        FurlPayClient $furlPayClient,
        \Magento\Sales\Model\OrderFactory $orderFactory
    ) {
        parent::__construct($context);
        $this->furlPayClient = $furlPayClient;
        $this->orderFactory = $orderFactory;
    }

    public function execute()
    {
        $request = $this->getRequest();
        $payload = $request->getContent();
        $signature = $request->getHeader('X-FurlPay-Signature');

        if (!$this->furlPayClient->verifyWebhookSignature($payload, $signature)) {
            $this->getResponse()->setStatusCode(403);
            return $this->getResponse()->setBody('Invalid signature');
        }

        $data = json_decode($payload, true);
        if (isset($data['orderId']) && $data['status'] === 'completed') {
            $order = $this->orderFactory->create()->loadByIncrementId($data['orderId']);
            if ($order->getId()) {
                $order->setState(\Magento\Sales\Model\Order::STATE_PROCESSING)
                      ->setStatus(\Magento\Sales\Model\Order::STATE_PROCESSING);
                $order->save();
            }
        }

        $this->getResponse()->setStatusCode(200);
        return $this->getResponse()->setBody('OK');
    }

    public function createCsrfValidationException(RequestInterface $request): ?InvalidRequestException
    {
        return null;
    }

    public function validateForCsrf(RequestInterface $request): ?bool
    {
        return true;
    }
}
