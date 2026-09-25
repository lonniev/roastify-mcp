// My coupons — the package's CouponsPanel in the Bench's look. Operators
// hand out codes off-network; redeem once and the discount applies itself.

import {
  couponExpiryText,
  couponStatusLabel,
  couponUsesText,
  type PatronCoupon,
} from "@tollbooth-dpyc/web";
import { CouponsPanel } from "@tollbooth-dpyc/web/react";
import { couponsLook } from "../lib/look";

export default function Coupons() {
  return (
    <CouponsPanel
      intro="Redeem an operator code once. The discount applies automatically on subsequent paid calls until the per-patron cap or the window expires."
      empty="No coupons redeemed yet. Operators distribute codes via X, email, the welcome page, or DM — paste a code above to claim its discount."
      placeholder="FRESHMAN, EARLYBIRD…"
      redeemLabel="🎟 Redeem"
      classNames={couponsLook}
      renderCoupon={(c, forget) => <CouponRow coupon={c} onForget={forget} />}
    />
  );
}

function CouponRow({ coupon, onForget }: { coupon: PatronCoupon; onForget: () => void }) {
  const active = coupon.status === "active";
  const expiry = active ? couponExpiryText(coupon.valid_until) : null;
  return (
    <>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm">{coupon.name}</span>
          <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{coupon.discount_percent}% off</span>
        </div>
        <div className="text-xs text-stone-400 dark:text-zinc-500 mt-0.5">
          <span className={active ? "text-green-600 dark:text-green-400" : ""}>{couponStatusLabel(coupon.status)}</span>
          {" · "}
          {couponUsesText(coupon)}
          {expiry && ` · ${expiry}`}
        </div>
      </div>
      <button
        type="button"
        onClick={onForget}
        title="Remove from your list (re-redeemable later while the window allows)"
        className="text-stone-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 text-sm px-2 py-1 transition-colors"
      >
        🗑
      </button>
    </>
  );
}
