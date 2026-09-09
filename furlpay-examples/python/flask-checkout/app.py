from flask import Flask, request, jsonify
import hmac
import hashlib

app = Flask(__name__)

@app.route('/create-payment', methods=['POST'])
def create_payment():
    return jsonify({'id': 'test', 'url': 'https://checkout.furlpay.com/test'})

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('x-furlpay-signature')
    if not signature:
        return 'Missing signature', 401
    
    expected = hmac.new(b'secret', request.get_data(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return 'Invalid signature', 401
    
    return 'OK', 200

if __name__ == '__main__':
    app.run(port=3000)
