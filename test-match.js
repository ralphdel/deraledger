function tokenizeName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokensMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}

function matchAffiliationByNameTest(verifiedName, registryPeople) {
  const verifiedTokens = tokenizeName(verifiedName);
  if (verifiedTokens.length === 0 || registryPeople.length === 0) {
    return { status: "no_match", score: 0, reason: "No comparable identity or registry people were available." };
  }

  let best = { status: "no_match", matchedName: "", score: 0, reason: "No registry name matched." };

  for (const person of registryPeople) {
    const personName = person.name || "";
    const registryTokens = tokenizeName(personName);
    const matchedCount = verifiedTokens.filter((left) =>
      registryTokens.some((right) => tokensMatch(left, right))
    ).length;
    const score = registryTokens.length > 0
      ? Math.round((matchedCount / Math.max(verifiedTokens.length, registryTokens.length)) * 100)
      : 0;

    const surname = registryTokens[0] || "";
    const surnameMatch = verifiedTokens.some((token) => tokensMatch(token, surname));
    const status =
      (surnameMatch && matchedCount >= 2 && score >= 70) ? "strong_match"
      : matchedCount >= 2 ? "partial_match"
      : matchedCount === 1 ? "partial_match"
      : "no_match";

    if (score > best.score) {
      best = {
        status,
        matchedName: personName,
        score,
        reason: status === "strong_match"
          ? "Surname plus at least one other token matched the registry record."
          : status === "partial_match"
            ? "Possible name ordering or spelling variation matched the registry record."
            : "No registry name matched.",
      };
    }
  }

  return best;
}

console.log(matchAffiliationByNameTest("Susan Doe", [{ name: "Peter Doe", role: "Director" }]));
console.log(matchAffiliationByNameTest("Suzan Doe", [{ name: "Susan Doe", role: "Director" }]));
