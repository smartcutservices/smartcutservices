export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeDimension(dimension = {}) {
  return {
    label: String(dimension?.label || '').trim(),
    enabled: dimension?.enabled !== false,
    price: Number(dimension?.price) || 0
  };
}

export function buildDimensionList(dimensions = []) {
  return (Array.isArray(dimensions) ? dimensions : [])
    .map((item) => normalizeDimension(item))
    .filter((item) => item.label);
}

export function normalizePaper(paper = {}, fallbackDimensions = []) {
  const dimensions = Array.isArray(paper?.dimensions) && paper.dimensions.length
    ? buildDimensionList(paper.dimensions)
    : buildDimensionList(fallbackDimensions);

  return {
    label: String(paper?.label || '').trim(),
    enabled: paper?.enabled !== false,
    dimensions
  };
}

export function collectUniqueDimensionsFromPapers(papers = [], fallbackDimensions = []) {
  const map = new Map();

  (Array.isArray(papers) ? papers : []).forEach((paper) => {
    (Array.isArray(paper?.dimensions) ? paper.dimensions : []).forEach((dimension) => {
      const normalized = normalizeDimension(dimension);
      if (!normalized.label || map.has(normalized.label)) return;
      map.set(normalized.label, normalized);
    });
  });

  if (map.size) {
    return Array.from(map.values());
  }

  return buildDimensionList(fallbackDimensions);
}

export function normalizePrintingConfig(defaultConfig, data = {}) {
  const defaults = deepClone(defaultConfig);
  const fallbackDimensions = collectUniqueDimensionsFromPapers(defaults.papers || [], defaults.dimensions || []);
  const legacyDimensions = Array.isArray(data?.dimensions) && data.dimensions.length
    ? buildDimensionList(data.dimensions)
    : fallbackDimensions;
  const papersSource = Array.isArray(data?.papers) && data.papers.length
    ? data.papers
    : (defaults.papers || []);
  const papers = papersSource
    .map((paper) => normalizePaper(paper, legacyDimensions))
    .filter((paper) => paper.label);

  return {
    ...defaults,
    ...data,
    papers,
    dimensions: collectUniqueDimensionsFromPapers(papers, legacyDimensions),
    pricing: {
      ...(defaults.pricing || {}),
      ...(data?.pricing || {})
    }
  };
}

export function getEnabledPapers(papers = []) {
  return (Array.isArray(papers) ? papers : []).filter((paper) => paper?.enabled !== false && paper?.label);
}

export function getEnabledDimensionsForPaper(papers = [], paperLabel = '') {
  const paper = getEnabledPapers(papers).find((entry) => entry.label === paperLabel);
  return (Array.isArray(paper?.dimensions) ? paper.dimensions : [])
    .filter((dimension) => dimension?.enabled !== false && dimension?.label);
}

export function findPaperByLabel(papers = [], paperLabel = '') {
  return getEnabledPapers(papers).find((entry) => entry.label === paperLabel) || null;
}

export function findDimensionByLabel(papers = [], paperLabel = '', dimensionLabel = '') {
  return getEnabledDimensionsForPaper(papers, paperLabel)
    .find((entry) => entry.label === dimensionLabel) || null;
}

export function ensureValidPaperSelection(papers = [], paperLabel = '') {
  if (findPaperByLabel(papers, paperLabel)) {
    return paperLabel;
  }

  return '';
}

export function ensureValidDimensionSelection(papers = [], paperLabel = '', dimensionLabel = '', preferredDimensionLabel = '') {
  const enabledDimensions = getEnabledDimensionsForPaper(papers, paperLabel);
  if (!enabledDimensions.length) return '';
  if (enabledDimensions.some((entry) => entry.label === dimensionLabel)) return dimensionLabel;
  if (preferredDimensionLabel && enabledDimensions.some((entry) => entry.label === preferredDimensionLabel)) {
    return preferredDimensionLabel;
  }
  return '';
}
