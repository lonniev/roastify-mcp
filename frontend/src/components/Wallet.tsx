// The Wallet: the package's WalletPage in the Bench's look, clocks in the
// patron's chosen display zone. Coupons live on Profile, so not here.

import { formatDate, formatDateTime } from "@tollbooth-dpyc/web";
import { WalletPage, useTimezone } from "@tollbooth-dpyc/web/react";
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
