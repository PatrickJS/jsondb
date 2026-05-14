const IRREGULAR_SINGULARS = new Map([
  ['people', 'person'],
  ['children', 'child'],
  ['settings', 'settings'],
]);

export function pascalCase(value) {
  return words(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function camelCase(value) {
  const parts = words(value);
  return parts
    .map((word, index) => {
      if (index === 0) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('');
}

export function kebabCase(value) {
  return words(value).join('-');
}

export function singularResourceName(resourceName) {
  const normalized = resourceName.toLowerCase();
  if (IRREGULAR_SINGULARS.has(normalized)) {
    return IRREGULAR_SINGULARS.get(normalized);
  }

  if (normalized.endsWith('ies') && normalized.length > 3) {
    return `${resourceName.slice(0, -3)}y`;
  }

  if (normalized.endsWith('ses') || normalized.endsWith('xes') || normalized.endsWith('ches') || normalized.endsWith('shes')) {
    return resourceName.slice(0, -2);
  }

  if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
    return resourceName.slice(0, -1);
  }

  return resourceName;
}

export function typeNameForResource(resourceName, kind = 'collection') {
  const base = kind === 'collection' ? singularResourceName(resourceName) : resourceName;
  return pascalCase(base);
}

export function routePathForResource(resourceName) {
  return `/${kebabCase(resourceName)}`;
}

function words(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}
