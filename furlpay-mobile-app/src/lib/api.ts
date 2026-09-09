// FurlPay API Client for Mobile
export class MobileApiClient {
    private baseUrl = 'https://api.furlpay.com/v1';

    async getHistory(walletAddress: string) {
        // Fetch tx history
        return [];
    }
}

export const api = new MobileApiClient();
