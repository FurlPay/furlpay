define([
    'uiComponent',
    'Magento_Checkout/js/model/payment/renderer-list'
], function (Component, rendererList) {
    'use strict';
    rendererList.push({
        type: 'furlpay',
        component: 'FurlPay_Payment/js/view/payment/furlpay'
    });
    return Component.extend({});
});
