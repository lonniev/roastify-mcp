// The Wallet: the package's WalletPage in the Bench's look, clocks in the
// patron's chosen display zone. Coupons live on Profile, so not here.

import { WalletPage } from "@tollbooth-dpyc/web/react";
import { formatDate, formatDateTime } from "../lib/timezone";
import { useTimezone } from "../lib/useTimezone";
import { walletLook } from "../lib/look";

export default function Wallet() {
  const [, timeZone] = useTimezone();
  return (
    <WalletPage
      coupons={false}
      statement={false}
      formatDate={(iso) => formatDate(iso, timeZone)}
      formatDateTime={(iso) => formatDateTime(iso, timeZone)}
      classNames={walletLook}
    />
  );
}
