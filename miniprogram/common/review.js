const DEFAULT_ANONYMOUS_AVATAR = '/images/review-anonymous-avatar.svg'

function padNumber(value) {
  return String(value).padStart(2, '0')
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function formatDate(value) {
  const date = toDate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`
}

function formatDateTime(value) {
  const date = toDate(value)
  if (!date) return ''
  return `${formatDate(date)} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
}

function formatScoreValue(score, count = 0) {
  const numeric = Number(score) || 0
  if ((Number(count) || 0) <= 0) {
    return '暂无评分'
  }
  return numeric.toFixed(1)
}

function decorateReview(review, options = {}) {
  const userInfo = review && review.user_info ? review.user_info : {}
  const rating = review && review.rating ? review.rating : {}
  const sellerReply = review && review.seller_reply
    ? {
        ...review.seller_reply,
        reply_time_text: formatDateTime(review.seller_reply.reply_time)
      }
    : null
  return {
    ...review,
    user_info: {
      nickname: userInfo.nickname || '用户',
      avatar: userInfo.avatar || DEFAULT_ANONYMOUS_AVATAR
    },
    seller_reply: sellerReply,
    buy_time_text: formatDate(review && review.buy_time),
    create_time_text: formatDateTime(review && review.create_time),
    sku_text: review && review.sku_info && review.sku_info.sku_name ? `款式：${review.sku_info.sku_name}` : '',
    product_rating_text: `${Number(rating.product || 0).toFixed(1)}`,
    avg_score_text: Number(review && review.avg_score ? review.avg_score : 0).toFixed(1),
    show_product_title: Boolean(options.showProductTitle)
  }
}

module.exports = {
  DEFAULT_ANONYMOUS_AVATAR,
  formatDate,
  formatDateTime,
  formatScoreValue,
  decorateReview
}
