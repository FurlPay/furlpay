<?php
namespace FurlPay\Payment\Model;

use Magento\Payment\Model\Method\AbstractMethod;

class Payment extends AbstractMethod
{
    const CODE = 'furlpay';
    
    protected $_code = self::CODE;
    protected $_isInitializeNeeded = true;
    protected $_canOrder = true;
    protected $_canAuthorize = true;
    protected $_canCapture = true;
    protected $_canRefund = true;

    protected $furlPayClient;

    public function __construct(
        \Magento\Framework\Model\Context $context,
        \Magento\Framework\Registry $registry,
        \Magento\Framework\Api\ExtensionAttributesFactory $extensionFactory,
        \Magento\Framework\Api\AttributeValueFactory $customAttributeFactory,
        \Magento\Payment\Helper\Data $paymentData,
        \Magento\Framework\App\Config\ScopeConfigInterface $scopeConfig,
        \Magento\Payment\Model\Method\Logger $logger,
        FurlPayClient $furlPayClient,
        \Magento\Framework\Model\ResourceModel\AbstractResource $resource = null,
        \Magento\Framework\Data\Collection\AbstractDb $resourceCollection = null,
        array $data = []
    ) {
        parent::__construct(
            $context,
            $registry,
            $extensionFactory,
            $customAttributeFactory,
            $paymentData,
            $scopeConfig,
            $logger,
            $resource,
            $resourceCollection,
            $data
        );
        $this->furlPayClient = $furlPayClient;
    }

    public function capture(\Magento\Payment\Model\InfoInterface $payment, $amount)
    {
        // Actually captured via Webhook usually for Solana
        return $this;
    }
    
    public function refund(\Magento\Payment\Model\InfoInterface $payment, $amount)
    {
        // Refund logic using FurlPayClient
        return $this;
    }
}
