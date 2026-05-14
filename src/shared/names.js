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

export function resourceNameCandidates(value) {
  const exact = String(value);
  return unique([
    exact,
    camelCase(exact),
    kebabCase(exact),
  ]);
}

export function resolveResource(resources, requestedName) {
  const candidates = resourceNameCandidates(requestedName);

  for (const candidate of candidates) {
    if (resources.has(candidate)) {
      return {
        resource: resources.get(candidate),
        matchedName: candidate,
        candidates,
      };
    }
  }

  return {
    resource: null,
    matchedName: null,
    candidates,
  };
}

export function resourceAliasCollisions(resources) {
  const aliasResources = new Map();
  const resourceList = Array.isArray(resources) ? resources : [...resources.values()];

  for (const resource of resourceList) {
    const resourceName = typeof resource === 'string' ? resource : resource.name;
    for (const alias of resourceNameCandidates(resourceName)) {
      const names = aliasResources.get(alias) ?? new Set();
      names.add(resourceName);
      aliasResources.set(alias, names);
    }
  }

  return [...aliasResources.entries()]
    .map(([alias, names]) => ({
      alias,
      resources: [...names].sort(),
    }))
    .filter((collision) => collision.resources.length > 1)
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function resourceAliasCollisionGroups(resources) {
  const groups = new Map();

  for (const collision of resourceAliasCollisions(resources)) {
    const key = collision.resources.join('\0');
    const group = groups.get(key) ?? {
      alias: collision.alias,
      aliases: [],
      resources: collision.resources,
      candidates: Object.fromEntries(collision.resources.map((resource) => [resource, resourceNameCandidates(resource)])),
    };
    group.aliases.push(collision.alias);
    groups.set(key, group);
  }

  return [...groups.values()];
}

export function resourceConfigValue(values, resourceName) {
  if (!values || typeof values !== 'object') {
    return undefined;
  }

  for (const candidate of resourceNameCandidates(resourceName)) {
    if (Object.prototype.hasOwnProperty.call(values, candidate)) {
      return values[candidate];
    }
  }

  return undefined;
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

function unique(values) {
  return [...new Set(values)];
}
