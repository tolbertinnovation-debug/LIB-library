import { LogoMark } from './Logo';

// Decorative barcode derived from the card number.
function Barcode({ value }: { value: string }) {
  const digits = value.replace(/\D/g, '').padEnd(12, '0');
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  const pattern = `1${digits}1`;
  for (const ch of pattern) {
    const d = Number(ch);
    const widths = [1 + (d % 3), 1 + ((d >> 1) % 2), 2 + (d % 2)];
    widths.forEach((w, i) => {
      if (i % 2 === 0) bars.push({ x, w });
      x += w + 1;
    });
  }
  return (
    <svg className="barcode" viewBox={`0 0 ${x} 30`} preserveAspectRatio="none" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height="30" fill="currentColor" />
      ))}
    </svg>
  );
}

export function LibraryCard({ name, cardNumber, since }: { name: string; cardNumber: string; since: string }) {
  return (
    <div className="library-card" aria-label={`Library card for ${name}, number ${cardNumber}`}>
      <div className="library-card-top">
        <LogoMark size={40} />
        <div>
          <div className="library-card-org">Liberia Online Library</div>
          <div className="library-card-kind">Member card</div>
        </div>
        <span className="library-card-star" aria-hidden>
          ★
        </span>
      </div>
      <div className="library-card-name">{name}</div>
      <div className="library-card-bottom">
        <div>
          <div className="library-card-label">Card number</div>
          <div className="library-card-number">{cardNumber}</div>
        </div>
        <div>
          <div className="library-card-label">Member since</div>
          <div>{new Date(since).getFullYear()}</div>
        </div>
      </div>
      <Barcode value={cardNumber} />
    </div>
  );
}
