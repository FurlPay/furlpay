export function formatCurrency(amount: number) {
    return `$${amount.toFixed(2)}`;
}

export function shortenAddress(address: string) {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
