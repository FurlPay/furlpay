import ExpoModulesCore
import PassKit

public class AppleWalletProvisioningModule: Module, PKAddPaymentPassViewControllerDelegate {
    
    private var addPaymentPassCompletion: ((PKAddPaymentPassRequest) -> Void)?
    
    public func definition() -> ModuleDefinition {
        Name("AppleWalletProvisioning")

        // `onProvisioningResult` is the ONLY thing JS may treat as a verdict.
        // `startPushProvisioning` resolves when the sheet is presented, which is
        // not an outcome — see lib/cards/provisioning.ts.
        Events("onCertificatesReceived", "onProvisioningResult")

        Function("canAddCard") { (suffix: String) -> Bool in
            let passLibrary = PKPassLibrary()
            if !PKAddPaymentPassViewController.canAddPaymentPass() {
                return false
            }
            
            // Check if card with matching suffix already exists
            let passes = passLibrary.passes(of: .payment)
            for pass in passes {
                guard let paymentPass = pass.paymentPass else { continue }
                if paymentPass.primaryAccountNumberSuffix == suffix {
                    return false // Already added
                }
            }
            return true
        }

        AsyncFunction("startPushProvisioning") { (cardholderName: String, lastFour: String, promise: Promise) in
            guard PKAddPaymentPassViewController.canAddPaymentPass() else {
                promise.reject("UNAVAILABLE", "Push provisioning is not available on this device")
                return
            }

            guard let config = PKAddPaymentPassRequestConfiguration(encryptionScheme: .ECC_V2) else {
                promise.reject("CONFIG_ERROR", "Failed to create request configuration")
                return
            }

            config.cardholderName = cardholderName
            config.primaryAccountSuffix = lastFour

            guard let viewController = PKAddPaymentPassViewController(requestConfiguration: config, delegate: self) else {
                promise.reject("VIEW_ERROR", "Failed to create PKAddPaymentPassViewController")
                return
            }

            guard let currentViewController = appContext?.utilities?.currentViewController() else {
                promise.reject("NO_VIEW_CONTROLLER", "No view controller to present from")
                return
            }

            currentViewController.present(viewController, animated: true, completion: nil)
            // Resolves because the SHEET OPENED. Deliberately not a verdict —
            // JS awaits `onProvisioningResult` for that.
            promise.resolve(true)
        }.runOnQueue(.main)

        // Hand the issuer-signed payload to the completion handler PassKit gave
        // us in the delegate. PassKit requires it EXACTLY ONCE per presented
        // sheet, so the handler is cleared before it is invoked — a second call
        // finds nothing pending and rejects rather than calling twice, which
        // PassKit treats as a programming error.
        AsyncFunction("completePushProvisioning") {
            (encryptedPassData: String, activationData: String, ephemeralPublicKey: String, promise: Promise) in

            guard let completion = self.addPaymentPassCompletion else {
                promise.reject("NO_PENDING_SESSION", "No provisioning sheet is awaiting a payload")
                return
            }

            guard let passData = Data(base64Encoded: encryptedPassData),
                  let actData = Data(base64Encoded: activationData),
                  let pubKey = Data(base64Encoded: ephemeralPublicKey) else {
                // Do NOT clear the handler here: the payload was bad, the sheet
                // is still open, and a corrected payload can still complete it.
                promise.reject("INVALID_BASE64", "Provisioning payload is not valid base64")
                return
            }

            let request = PKAddPaymentPassRequest()
            request.encryptedPassData = passData
            request.activationData = actData
            request.ephemeralPublicKey = pubKey

            self.addPaymentPassCompletion = nil
            completion(request)
            promise.resolve(true)
        }.runOnQueue(.main)
    }

    public func addPaymentPassViewController(_ controller: PKAddPaymentPassViewController, generateRequestWithCertificateChain certificates: [Data], nonce: Data, nonceSignature: Data, completionHandler: @escaping (PKAddPaymentPassRequest) -> Void) {
        
        self.addPaymentPassCompletion = completionHandler
        
        let certsBase64 = certificates.map { $0.base64EncodedString() }
        let nonceBase64 = nonce.base64EncodedString()
        let nonceSignatureBase64 = nonceSignature.base64EncodedString()
        
        sendEvent("onCertificatesReceived", [
            "certificates": certsBase64,
            "nonce": nonceBase64,
            "nonceSignature": nonceSignatureBase64
        ])
    }

    /// The verdict. This is the only place that can report a card as added.
    ///
    /// PassKit's three outcomes are distinguished, because collapsing them is
    /// how a cancellation gets reported as a failure (alarming) or a failure as
    /// a success (dangerous):
    ///
    ///   pass != nil               the pass is in the wallet
    ///   pass == nil, error != nil the platform refused, with a reason
    ///   pass == nil, error == nil the user dismissed the sheet
    ///
    /// Emitted BEFORE dismissal so the event cannot be lost if the module is
    /// torn down during the dismiss animation.
    public func addPaymentPassViewController(_ controller: PKAddPaymentPassViewController, didFinishAdding pass: PKPaymentPass?, error: Error?) {
        if pass != nil {
            sendEvent("onProvisioningResult", ["added": true])
        } else if let error {
            sendEvent("onProvisioningResult", [
                "added": false,
                "error": error.localizedDescription
            ])
        } else {
            sendEvent("onProvisioningResult", ["added": false, "cancelled": true])
        }

        // Released here as well as in completePushProvisioning: the sheet can
        // finish without a payload ever being supplied (a cancellation), and a
        // handler surviving that would be invoked against the next attempt's
        // sheet.
        self.addPaymentPassCompletion = nil
        controller.dismiss(animated: true, completion: nil)
    }
}
