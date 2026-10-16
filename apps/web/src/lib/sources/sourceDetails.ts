/**
 * Structured source data for the remote catalogue cards.
 *
 * Core systems and their accepted extensions are related, but they are different data points.
 * Keep their relationship in the returned objects so the UI can present each system and its
 * own extensions clearly. Do not flatten this into a sentence or join it with punctuation.
 *
 * This module is intentionally pure and rune-free. Every string comes from a third-party
 * manifest and must be rendered as text by the caller.
 */
import { isCoreKind } from "./types.js";

export interface SourceSystemCard {
  kind: string;
  systems: { id?: string; longName: string; extensions?: string[]; logoDataUrl?: string }[];
}

export interface SourceSystemDetail {
  id: string;
  name: string;
  extensions: string[];
  logoDataUrl?: string;
}

/** Return one record per declared core system, preserving that system's own extensions. */
export function systemsData(card: SourceSystemCard | undefined): SourceSystemDetail[] {
  if (card === undefined || !isCoreKind(card.kind)) return [];
  return card.systems.map((system, index) => ({
    id: system.id ?? `${system.longName}:${index}`,
    name: system.longName,
    extensions: [...(system.extensions ?? [])],
    ...(system.logoDataUrl ? { logoDataUrl: system.logoDataUrl } : {}),
  }));
}
