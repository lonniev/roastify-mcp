// Cloudflare Pages Function: /mcp → the roastify-mcp operator on Horizon.
import { makeMcpProxy } from "@tollbooth-dpyc/web/pages-proxy";

export const onRequest = makeMcpProxy("https://roastify-mcp.fastmcp.app/mcp");
