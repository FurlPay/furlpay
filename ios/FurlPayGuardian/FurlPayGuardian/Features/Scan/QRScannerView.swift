//
//  QRScannerView.swift
//
//  Port of native-app/app/scan.tsx.
//
//  AVFoundation directly rather than a wrapper: the whole job is one
//  AVCaptureMetadataOutput, and a dependency for that would be more code than
//  the code.
//
//  The scanner NEVER acts on what it reads. It hands the string back and the
//  caller decides — SendView runs it through the validator, which rejects
//  anything that is not a well-formed address for the selected chain. A scanner
//  that navigated or pre-filled an amount would make a printed QR code into an
//  instruction, and a sticker over a real one into an attack.
//

import SwiftUI
import AVFoundation

struct QRScannerView: View {
    @Environment(\.dismiss) private var dismiss
    let onScan: (String) -> Void

    @State private var permission: Permission = .undetermined
    @State private var torchOn = false

    private enum Permission { case undetermined, granted, denied }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                switch permission {
                case .granted:
                    CameraPreview(torchOn: torchOn) { value in
                        // Fire once. Metadata output delivers continuously
                        // while the code is in frame, and a caller that
                        // dismisses on scan would get several calls.
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        onScan(value)
                    }
                    .ignoresSafeArea()
                    reticle

                case .denied:
                    permissionPrompt

                case .undetermined:
                    ProgressView().tint(.white)
                }
            }
            .navigationTitle("Scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.black, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                if permission == .granted {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            torchOn.toggle()
                        } label: {
                            Image(systemName: torchOn ? "bolt.fill" : "bolt.slash")
                        }
                        .accessibilityLabel(torchOn ? "Turn torch off" : "Turn torch on")
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await requestAccess() }
    }

    private var reticle: some View {
        VStack {
            Spacer()
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Color.white.opacity(0.9), lineWidth: 3)
                .frame(width: 240, height: 240)
                .accessibilityHidden(true)
            Text("Point at a QR code")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.8))
                .padding(.top, 18)
            Spacer()
        }
    }

    private var permissionPrompt: some View {
        VStack(spacing: 14) {
            Image(systemName: "camera.fill")
                .font(.system(size: 40))
                .foregroundStyle(.white.opacity(0.6))
            Text("Camera access is off")
                .font(.headline)
                .foregroundStyle(.white)
            Text("Allow camera access in Settings to scan payment codes.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(GuardianColors.primaryAccent)
        }
        .padding(32)
    }

    private func requestAccess() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            permission = .granted
        case .notDetermined:
            permission = await AVCaptureDevice.requestAccess(for: .video) ? .granted : .denied
        default:
            permission = .denied
        }
    }
}

// MARK: - Camera

private struct CameraPreview: UIViewRepresentable {
    let torchOn: Bool
    let onScan: (String) -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.onScan = { value in
            // Debounced in the coordinator, not here — see `hasScanned`.
            guard !context.coordinator.hasScanned else { return }
            context.coordinator.hasScanned = true
            onScan(value)
        }
        view.start()
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.setTorch(torchOn)
    }

    static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) {
        // Without this the capture session keeps running after dismissal and
        // the torch stays lit.
        view.stop()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var hasScanned = false
    }
}

private final class PreviewView: UIView, AVCaptureMetadataOutputObjectsDelegate {
    var onScan: ((String) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.furlpay.guardian.scanner")

    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    private var previewLayer: AVCaptureVideoPreviewLayer {
        layer as! AVCaptureVideoPreviewLayer
    }

    func start() {
        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill

        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()

            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  self.session.canAddInput(input)
            else {
                self.session.commitConfiguration()
                return
            }
            self.session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard self.session.canAddOutput(output) else {
                self.session.commitConfiguration()
                return
            }
            self.session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            // Set AFTER adding the output — the available types are empty
            // until then, and assigning first silently scans nothing.
            output.metadataObjectTypes = [.qr]

            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
        setTorch(false)
    }

    func setTorch(_ on: Bool) {
        guard let device = AVCaptureDevice.default(for: .video),
              device.hasTorch, device.isTorchAvailable else { return }
        try? device.lockForConfiguration()
        device.torchMode = on ? .on : .off
        device.unlockForConfiguration()
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue, !value.isEmpty
        else { return }
        onScan?(value)
    }
}
