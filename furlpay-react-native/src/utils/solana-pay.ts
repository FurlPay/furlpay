export const parseSolanaPayUrl = (url: string) => {
  if (!url.startsWith('solana:')) {
    throw new Error('Invalid Solana Pay URL');
  }
  
  const [recipient, query] = url.replace('solana:', '').split('?');
  const params = new URLSearchParams(query);
  
  return {
    recipient,
    amount: params.get('amount'),
    reference: params.getAll('reference'),
    label: params.get('label'),
    message: params.get('message'),
  };
};

export const buildSolanaPayUrl = (recipient: string, amount: string, reference?: string) => {
  let url = `solana:${recipient}?amount=${amount}`;
  if (reference) {
    url += `&reference=${reference}`;
  }
  return url;
};
