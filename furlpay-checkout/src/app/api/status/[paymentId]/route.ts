import { NextResponse } from 'next/server';
import { checkPaymentStatus } from '@/lib/payment-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { paymentId: string } }) {
  const { paymentId } = params;
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      const sendStatus = async () => {
        const status = await checkPaymentStatus(paymentId);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(status)}\n\n`));
        if (status.status === 'completed' || status.status === 'failed') {
          controller.close();
        }
      };

      await sendStatus();
      const interval = setInterval(sendStatus, 2000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
