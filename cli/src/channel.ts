// The release channels `your-space upgrade --channel` follows (spec 016): Alpha, the published
// releases, and Canary, the canary builds of main. Each has a feed at a fixed address, channel.json
// on the rolling prerelease tagged with the channel's name, which names the channel's newest build
// in one form (deploy/channel-json.sh). Nothing looks up tags or lists releases.
import { CliError } from "./errors.ts";
import { releasesBase } from "./release.ts";
import { isCanary, isVersion } from "./version.ts";

export const CHANNELS = ["alpha", "canary"] as const;
export type Channel = (typeof CHANNELS)[number];

/** A channel's name as the guides write it. */
export const CHANNEL_NAMES: Record<Channel, string> = { alpha: "Alpha", canary: "Canary" };

/** What a channel's channel.json names: its newest build, and the full commit it was made from. */
export interface ChannelBuild {
  channel: Channel;
  version: string;
  commit: string;
}

/** The channel's feed: channel.json on the rolling prerelease tagged with its name. */
export function channelUrl(channel: Channel): string {
  return `${releasesBase()}/${channel}/channel.json`;
}

/**
 * Reads a channel.json, refusing one that isn't in the form every channel.json has: Alpha's never
 * names a canary, so an Alpha installation never gets one, and Canary's names only a canary.
 */
export function parseChannel(text: string, channel: Channel): ChannelBuild {
  const name = CHANNEL_NAMES[channel];
  const refuse = (why: string) =>
    new CliError("checksum_mismatch", `The ${name} channel's channel.json ${why}, so nothing was downloaded. Nothing was changed; run this again later.`, { channel });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw refuse("isn't JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw refuse("isn't a channel's feed");
  const named = value as Record<string, unknown>;
  if (named.channel !== channel) throw refuse(`names another channel (${JSON.stringify(named.channel ?? null)})`);
  const version = named.version;
  if (typeof version !== "string" || !isVersion(version)) throw refuse("doesn't name a version");
  if (channel === "alpha" && isCanary(version)) throw refuse(`names ${version}, a canary build, which Alpha never does`);
  if (channel === "canary" && !isCanary(version)) throw refuse(`names ${version}, which isn't a canary build`);
  const commit = named.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) throw refuse("doesn't name the full commit its build was made from");
  return { channel, version, commit };
}

/** Reads a channel's channel.json with one request. */
export async function readChannel(channel: Channel): Promise<ChannelBuild> {
  const url = channelUrl(channel);
  const name = CHANNEL_NAMES[channel];
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { redirect: "follow" });
    text = await response.text();
  } catch (error) {
    throw new CliError("download_failed", `Couldn't read the ${name} channel's feed, ${url}. Check this machine's internet connection, then run this again. Nothing was changed.`, { channel }, String(error));
  }
  if (!response.ok) {
    const why = response.status === 404 ? "isn't there" : `answered ${response.status} ${response.statusText}`;
    throw new CliError("download_failed", `The ${name} channel's feed, ${url}, ${why}. Nothing was changed; run this again later.`, { channel });
  }
  return parseChannel(text, channel);
}
