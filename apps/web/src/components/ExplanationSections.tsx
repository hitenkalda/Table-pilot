import type { DishExplanation } from "../types";

/** Shared explanation body used by both the menu bottom sheet and the
 *  full dish page — the four blueprint sections plus the safety note. */
export function ExplanationSections({ explanation }: { explanation: DishExplanation }) {
  return (
    <>
      <section aria-labelledby="sec-what">
        <h4 id="sec-what">What it is</h4>
        <p>{explanation.whatItIs}</p>
      </section>

      <section aria-labelledby="sec-taste">
        <h4 id="sec-taste">Taste, texture &amp; spice</h4>
        <p>{explanation.tasteAndTexture}</p>
        <p>
          Spice: <strong>{explanation.spice.label}</strong>
          {typeof explanation.spice.level === "number" && (
            <span aria-hidden="true"> {"🌶".repeat(explanation.spice.level) || "—"}</span>
          )}
        </p>
        {explanation.portionNote && <p>Portion: {explanation.portionNote}</p>}
      </section>

      <section aria-labelledby="sec-ingredients">
        <h4 id="sec-ingredients">Ingredients &amp; dietary information</h4>
        {explanation.ingredients.length > 0 ? (
          <p>{explanation.ingredients.join(" · ")}</p>
        ) : (
          <p className="not-provided">Ingredients have not been provided by the restaurant.</p>
        )}
        <div className="chips" style={{ margin: "8px 0" }}>
          {explanation.dietary.map((tag) => (
            <span key={tag} className="chip">{tag}</span>
          ))}
          {explanation.dietary.length === 0 && (
            <span className="chip">No dietary labels confirmed</span>
          )}
        </div>
        {explanation.allergens.declared.length > 0 ? (
          <p>Declared allergens: {explanation.allergens.declared.join(", ")}</p>
        ) : (
          <p className="not-provided">No allergens declared by the restaurant.</p>
        )}
        {explanation.allergens.unknown && (
          <p className="not-provided">
            Allergen status for this dish is unknown — treat as not verified.
          </p>
        )}
      </section>

      <div className="safety-note" role="note">{explanation.safetyNote}</div>
    </>
  );
}
