const DEFAULT_USER_STATS = {
  following: 0,
  followers: 0,
  likes: 0,
  views: 0
}

const USER_BIO_MAX_LENGTH = 60
const USER_BIO_MAX_LINES = 5

const DEFAULT_USER_PROFILE = {
  nickname: '',
  avatar_url: '',
  avatar_file_id: '',
  avatar: '',
  bio: '',
  profile_bg_url: '',
  is_certified: false,
  real_name: '',
  ich_category: '',
  workshop_id: '',
  draft_count: 0,
  stats: DEFAULT_USER_STATS
}

function cloneDefaultStats() {
  return { ...DEFAULT_USER_STATS }
}

function normalizeLineBreaks(text = '') {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function countTextLength(text = '') {
  return Array.from(String(text || '')).length
}

function getUserBioLength(text = '') {
  return countTextLength(normalizeLineBreaks(text))
}

function getUserBioLineCount(text = '') {
  const normalized = normalizeLineBreaks(text)
  if (!normalized) return 0
  return normalized.split('\n').length
}

function sanitizeUserBio(text = '') {
  const normalized = normalizeLineBreaks(text)
  const lines = normalized.split('\n').slice(0, USER_BIO_MAX_LINES)

  let output = ''
  lines.forEach((line, index) => {
    const next = index === 0 ? line : `\n${line}`
    const nextLength = getUserBioLength(output + next)
    if (nextLength <= USER_BIO_MAX_LENGTH) {
      output += next
      return
    }

    const remain = USER_BIO_MAX_LENGTH - getUserBioLength(output)
    if (remain > 0) {
      output += Array.from(next).slice(0, remain).join('')
    }
  })

  return output
}

function validateUserBio(text = '') {
  const normalized = normalizeLineBreaks(text)
  const length = getUserBioLength(normalized)
  const lineCount = getUserBioLineCount(normalized)

  if (length > USER_BIO_MAX_LENGTH) {
    return {
      valid: false,
      message: `个人简介最多${USER_BIO_MAX_LENGTH}字`
    }
  }

  if (lineCount > USER_BIO_MAX_LINES) {
    return {
      valid: false,
      message: `个人简介最多${USER_BIO_MAX_LINES}行`
    }
  }

  return {
    valid: true,
    message: '',
    value: normalized
  }
}

function createDefaultUserProfile() {
  return {
    ...DEFAULT_USER_PROFILE,
    stats: cloneDefaultStats()
  }
}

function normalizeUserProfile(userInfo = {}) {
  const normalized = {
    ...createDefaultUserProfile(),
    ...(userInfo || {})
  }

  normalized.stats = {
    ...cloneDefaultStats(),
    ...((userInfo && userInfo.stats) || {})
  }

  if (!normalized.avatar_file_id && normalized.avatar_url) {
    normalized.avatar_file_id = normalized.avatar_url
  }
  if (!normalized.avatar && normalized.avatar_url) {
    normalized.avatar = normalized.avatar_url
  }

  normalized.nickname = String(normalized.nickname || '')
  normalized.avatar_url = String(normalized.avatar_url || '')
  normalized.avatar_file_id = String(normalized.avatar_file_id || '')
  normalized.avatar = String(normalized.avatar || '')
  normalized.bio = String(normalized.bio || '')
  normalized.profile_bg_url = String(normalized.profile_bg_url || '')
  normalized.real_name = String(normalized.real_name || '')
  normalized.ich_category = String(normalized.ich_category || '')
  normalized.workshop_id = String(normalized.workshop_id || '')
  normalized.draft_count = Number(normalized.draft_count) || 0
  normalized.is_certified = Boolean(normalized.is_certified)
  normalized.stats.following = Number(normalized.stats.following) || 0
  normalized.stats.followers = Number(normalized.stats.followers) || 0
  normalized.stats.likes = Number(normalized.stats.likes) || 0
  normalized.stats.views = Number(normalized.stats.views) || 0

  return normalized
}

function getMissingUserProfilePatch(userInfo = {}) {
  const patch = {}
  const source = userInfo || {}

  Object.keys(DEFAULT_USER_PROFILE).forEach((key) => {
    if (key === 'stats') return
    if (!(key in source) || source[key] === undefined) {
      patch[key] = DEFAULT_USER_PROFILE[key]
    }
  })

  const statsSource = source.stats
  if (!statsSource || typeof statsSource !== 'object' || Array.isArray(statsSource)) {
    patch.stats = cloneDefaultStats()
  } else {
    const statsPatch = {}
    Object.keys(DEFAULT_USER_STATS).forEach((key) => {
      if (!(key in statsSource) || statsSource[key] === undefined) {
        statsPatch[key] = DEFAULT_USER_STATS[key]
      }
    })
    if (Object.keys(statsPatch).length) {
      patch.stats = {
        ...cloneDefaultStats(),
        ...statsSource,
        ...statsPatch
      }
    }
  }

  return patch
}

module.exports = {
  DEFAULT_USER_PROFILE,
  DEFAULT_USER_STATS,
  USER_BIO_MAX_LENGTH,
  USER_BIO_MAX_LINES,
  createDefaultUserProfile,
  normalizeUserProfile,
  getMissingUserProfilePatch,
  sanitizeUserBio,
  validateUserBio,
  getUserBioLength,
  getUserBioLineCount
}
