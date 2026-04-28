/**
 * RxNorm API integration — NLM's drug terminology service.
 *
 * Replaces the curated 20-entry interaction database with the
 * National Library of Medicine's comprehensive drug database.
 *
 * API: https://rxnav.nlm.nih.gov/REST
 * No API key required. Free, public, authoritative.
 *
 * Capabilities:
 * - Drug name normalization (brand → generic)
 * - RxCUI lookup (unique drug identifier)
 * - Drug-drug interaction checking via DrugBank/ONCHigh
 * - NDC (National Drug Code) to RxNorm mapping
 * - Ingredient/component lookup
 */

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';
const INTERACTION_BASE = 'https://rxnav.nlm.nih.gov/REST/interaction';

export interface RxNormDrug {
  rxcui: string;
  name: string;
  tty: string; // Term type: SCD, SBD, IN, BN, etc.
  synonym?: string;
}

export interface RxNormInteraction {
  drug1: { rxcui: string; name: string };
  drug2: { rxcui: string; name: string };
  severity: string;
  description: string;
  source: string; // DrugBank, ONCHigh, etc.
}

export class RxNormClient {
  /**
   * Look up a drug by name → get RxCUI (unique identifier).
   */
  async findDrug(name: string): Promise<RxNormDrug[]> {
    const response = await fetch(
      `${RXNORM_BASE}/drugs.json?name=${encodeURIComponent(name)}`
    );
    if (!response.ok) return [];

    const data = await response.json() as {
      drugGroup?: {
        conceptGroup?: Array<{
          tty: string;
          conceptProperties?: Array<{ rxcui: string; name: string; synonym?: string; tty: string }>;
        }>;
      };
    };

    const results: RxNormDrug[] = [];
    for (const group of data.drugGroup?.conceptGroup ?? []) {
      for (const prop of group.conceptProperties ?? []) {
        results.push({
          rxcui: prop.rxcui,
          name: prop.name,
          tty: prop.tty,
          synonym: prop.synonym,
        });
      }
    }

    return results;
  }

  /**
   * Get RxCUI by approximate name match.
   * More forgiving than exact lookup — handles typos and brand names.
   */
  async approximateMatch(term: string): Promise<RxNormDrug | null> {
    const response = await fetch(
      `${RXNORM_BASE}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=1`
    );
    if (!response.ok) return null;

    const data = await response.json() as {
      approximateGroup?: {
        candidate?: Array<{ rxcui: string; name: string; score: string }>;
      };
    };

    const candidate = data.approximateGroup?.candidate?.[0];
    if (!candidate) return null;

    return { rxcui: candidate.rxcui, name: candidate.name, tty: 'SCD' };
  }

  /**
   * Check interactions between a list of drugs.
   * Uses NLM's interaction API (DrugBank + ONCHigh sources).
   */
  async checkInteractions(rxcuis: string[]): Promise<RxNormInteraction[]> {
    if (rxcuis.length < 2) return [];

    const response = await fetch(
      `${INTERACTION_BASE}/list.json?rxcuis=${rxcuis.join('+')}`
    );
    if (!response.ok) return [];

    const data = await response.json() as {
      fullInteractionTypeGroup?: Array<{
        fullInteractionType?: Array<{
          interactionPair?: Array<{
            severity?: string;
            description?: string;
            interactionConcept?: Array<{
              minConceptItem?: { rxcui: string; name: string };
            }>;
          }>;
          comment?: string;
          minConcept?: Array<{ rxcui: string; name: string }>;
        }>;
        sourceName?: string;
      }>;
    };

    const interactions: RxNormInteraction[] = [];

    for (const group of data.fullInteractionTypeGroup ?? []) {
      const source = group.sourceName ?? 'unknown';

      for (const type of group.fullInteractionType ?? []) {
        for (const pair of type.interactionPair ?? []) {
          const concepts = pair.interactionConcept ?? [];
          if (concepts.length >= 2) {
            interactions.push({
              drug1: {
                rxcui: concepts[0].minConceptItem?.rxcui ?? '',
                name: concepts[0].minConceptItem?.name ?? '',
              },
              drug2: {
                rxcui: concepts[1].minConceptItem?.rxcui ?? '',
                name: concepts[1].minConceptItem?.name ?? '',
              },
              severity: pair.severity ?? 'unknown',
              description: pair.description ?? '',
              source,
            });
          }
        }
      }
    }

    return interactions;
  }

  /**
   * Full workflow: take drug names → normalize → check interactions.
   * This is the primary entry point for clinical use.
   */
  async checkInteractionsByName(
    drugNames: string[]
  ): Promise<{
    drugs: Array<{ name: string; rxcui: string; normalized: string }>;
    interactions: RxNormInteraction[];
    hasSevere: boolean;
    unmatchedDrugs: string[];
  }> {
    // Step 1: Resolve each drug name to RxCUI
    const drugs: Array<{ name: string; rxcui: string; normalized: string }> = [];
    const unmatchedDrugs: string[] = [];
    const rxcuis: string[] = [];

    for (const name of drugNames) {
      const match = await this.approximateMatch(name);
      if (match) {
        drugs.push({ name, rxcui: match.rxcui, normalized: match.name });
        rxcuis.push(match.rxcui);
      } else {
        unmatchedDrugs.push(name);
      }
    }

    // Step 2: Check interactions
    const interactions = rxcuis.length >= 2
      ? await this.checkInteractions(rxcuis)
      : [];

    const hasSevere = interactions.some(
      (i) => i.severity?.toLowerCase().includes('high') || i.severity?.toLowerCase().includes('critical')
    );

    return { drugs, interactions, hasSevere, unmatchedDrugs };
  }

  /**
   * Get all ingredients for a drug (useful for allergy cross-checking).
   */
  async getIngredients(rxcui: string): Promise<Array<{ rxcui: string; name: string }>> {
    const response = await fetch(
      `${RXNORM_BASE}/rxcui/${rxcui}/allrelated.json`
    );
    if (!response.ok) return [];

    const data = await response.json() as {
      allRelatedGroup?: {
        conceptGroup?: Array<{
          tty: string;
          conceptProperties?: Array<{ rxcui: string; name: string }>;
        }>;
      };
    };

    const ingredients: Array<{ rxcui: string; name: string }> = [];
    for (const group of data.allRelatedGroup?.conceptGroup ?? []) {
      if (group.tty === 'IN' || group.tty === 'MIN') { // IN = Ingredient, MIN = Multiple Ingredients
        for (const prop of group.conceptProperties ?? []) {
          ingredients.push({ rxcui: prop.rxcui, name: prop.name });
        }
      }
    }

    return ingredients;
  }

  /**
   * NDC (barcode) to drug name lookup — for BCMA scanning.
   */
  async ndcToRxNorm(ndc: string): Promise<RxNormDrug | null> {
    const response = await fetch(
      `${RXNORM_BASE}/ndcstatus.json?ndc=${encodeURIComponent(ndc)}`
    );
    if (!response.ok) return null;

    const data = await response.json() as {
      ndcStatus?: { rxcui?: string; conceptName?: string };
    };

    if (!data.ndcStatus?.rxcui) return null;

    return {
      rxcui: data.ndcStatus.rxcui,
      name: data.ndcStatus.conceptName ?? '',
      tty: 'SCD',
    };
  }
}
