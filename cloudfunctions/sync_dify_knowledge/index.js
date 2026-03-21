const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const DIFY_API_BASE = 'https://api.dify.ai/v1';
const MAX_RETRY = 2;

function getConfig() {
  const apiKey = process.env.DIFY_KNOWLEDGE_API_KEY;
  const datasetId = process.env.DIFY_DATASET_ID;
  if (!apiKey || !datasetId) {
    throw new Error('缺少环境变量 DIFY_KNOWLEDGE_API_KEY 或 DIFY_DATASET_ID');
  }
  return { apiKey, datasetId };
}

function getHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

/**
 * 组装帖子的"超级文本"供 Dify 知识库 RAG 检索
 * 严格遵循开发文档 3.1 节的组装规则
 */
function assembleText(post) {
  let difyText = `【标题】：${post.title || '无标题'}\n【正文】：${post.content || ''}\n`;

  if (post.related_projects && post.related_projects.length > 0) {
    const names = post.related_projects.map(p => p.name).join('、');
    difyText += `【关联非遗项目】：${names}\n`;
  }

  if (post.tags && post.tags.length > 0) {
    difyText += `【话题标签】：${post.tags.join('、')}\n`;
  }

  const images = post.images || [];
  const visualAssets = images.filter(img => img.process_status === 1 && img.ai_description);
  if (visualAssets.length > 0) {
    difyText += `【包含的视觉资产】：\n`;
    visualAssets.forEach(img => {
      difyText += `【IMG:${img.url}|${img.ai_description}】\n`;
    });
  }

  return difyText;
}

/**
 * 带重试的 HTTP 请求
 */
async function requestWithRetry(fn, retries = MAX_RETRY) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (i < retries && (status >= 500 || err.code === 'ECONNABORTED' || !status)) {
        console.warn(`[Dify] 请求失败(第${i + 1}次)，${1000 * (i + 1)}ms 后重试:`, err.message);
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * 场景 A：创建新文档
 */
async function createDocument(post, postId, config) {
  const text = assembleText(post);
  const url = `${DIFY_API_BASE}/datasets/${config.datasetId}/document/create_by_text`;

  const res = await requestWithRetry(() =>
    axios.post(url, {
      name: `post_${postId}.txt`,
      text: text,
      indexing_technique: 'high_quality',
      process_rule: { mode: 'automatic' }
    }, {
      headers: getHeaders(config.apiKey),
      timeout: 30000
    })
  );

  const docId = res.data?.document?.id;
  if (!docId) {
    throw new Error('Dify 返回数据中缺少 document.id');
  }

  await db.collection('community_posts').doc(postId).update({
    data: {
      dify_doc_id: docId,
      pipeline_status: 'synced'
    }
  });

  console.log(`[Dify] 场景A：文档创建成功, post=${postId}, dify_doc_id=${docId}`);
  return docId;
}

/**
 * 场景 B：删除文档
 */
async function deleteDocument(postId, difyDocId, config) {
  const url = `${DIFY_API_BASE}/datasets/${config.datasetId}/documents/${difyDocId}`;

  await requestWithRetry(() =>
    axios.delete(url, {
      headers: getHeaders(config.apiKey),
      timeout: 15000
    })
  );

  await db.collection('community_posts').doc(postId).update({
    data: {
      dify_doc_id: '',
      pipeline_status: 'synced'
    }
  }).catch(err => {
    console.warn('[Dify] 删除后回写数据库失败(帖子可能已被删除):', err.message);
  });

  console.log(`[Dify] 场景B：文档删除成功, post=${postId}, dify_doc_id=${difyDocId}`);
}

/**
 * 禁用文档：将文档下所有分段的 enabled 设为 false，AI 检索不到但保留向量数据
 */
async function disableDocument(postId, difyDocId, config) {
  const segments = await fetchAllSegments(difyDocId, config);
  if (segments.length === 0) {
    console.log(`[Dify] 文档 ${difyDocId} 无分段，跳过禁用`);
    return;
  }

  for (const seg of segments) {
    if (!seg.enabled) continue;
    const url = `${DIFY_API_BASE}/datasets/${config.datasetId}/documents/${difyDocId}/segments/${seg.id}`;
    await requestWithRetry(() =>
      axios.post(url, { segment: { enabled: false } }, {
        headers: getHeaders(config.apiKey),
        timeout: 15000
      })
    );
  }

  console.log(`[Dify] 文档已禁用(${segments.length}个分段), post=${postId}, dify_doc_id=${difyDocId}`);
}

/**
 * 启用文档：将文档下所有分段的 enabled 恢复为 true
 */
async function enableDocument(postId, difyDocId, config) {
  const segments = await fetchAllSegments(difyDocId, config);
  if (segments.length === 0) {
    console.log(`[Dify] 文档 ${difyDocId} 无分段，跳过启用`);
    return;
  }

  for (const seg of segments) {
    if (seg.enabled) continue;
    const url = `${DIFY_API_BASE}/datasets/${config.datasetId}/documents/${difyDocId}/segments/${seg.id}`;
    await requestWithRetry(() =>
      axios.post(url, { segment: { enabled: true } }, {
        headers: getHeaders(config.apiKey),
        timeout: 15000
      })
    );
  }

  console.log(`[Dify] 文档已启用(${segments.length}个分段), post=${postId}, dify_doc_id=${difyDocId}`);
}

/**
 * 查询文档的所有分段
 */
async function fetchAllSegments(difyDocId, config) {
  const url = `${DIFY_API_BASE}/datasets/${config.datasetId}/documents/${difyDocId}/segments`;
  const res = await requestWithRetry(() =>
    axios.get(url, {
      headers: getHeaders(config.apiKey),
      timeout: 15000
    })
  );
  return res.data?.data || [];
}

/**
 * 场景 C：更新文档
 */
async function updateDocument(post, postId, difyDocId, config) {
  const text = assembleText(post);
  const url = `${DIFY_API_BASE}/datasets/${config.datasetId}/documents/${difyDocId}/update_by_text`;

  await requestWithRetry(() =>
    axios.post(url, {
      name: `post_${postId}.txt`,
      text: text
    }, {
      headers: getHeaders(config.apiKey),
      timeout: 30000
    })
  );

  await db.collection('community_posts').doc(postId).update({
    data: {
      pipeline_status: 'synced'
    }
  });

  console.log(`[Dify] 场景C：文档更新成功, post=${postId}, dify_doc_id=${difyDocId}`);
}

/**
 * sync_dify_knowledge 云函数入口
 *
 * @param {string} event.post_id - 帖子 ID（必填）
 * @param {string} [event.action] - 操作类型：
 *   'delete'  — 硬删除文档（彻底删帖时用）
 *   'disable' — 软禁用文档所有分段（设为私密时用，保留向量数据）
 *   'enable'  — 重新启用文档所有分段（从私密恢复公开时用）
 *   缺省      — 自动判断 create / update
 */
exports.main = async (event, context) => {
  const { post_id, action } = event;
  if (!post_id) {
    return { success: false, msg: '缺少 post_id 参数' };
  }

  let config;
  try {
    config = getConfig();
  } catch (err) {
    console.error('[Dify] 配置错误:', err.message);
    return { success: false, msg: err.message };
  }

  try {
    const postRes = await db.collection('community_posts').doc(post_id).get();
    const post = postRes.data;

    if (!post) {
      return { success: false, msg: '帖子不存在' };
    }

    const difyDocId = post.dify_doc_id || '';

    // ===== 硬删除（彻底删帖）=====
    if (action === 'delete') {
      if (!difyDocId) {
        console.log(`[Dify] 帖子 ${post_id} 无 dify_doc_id，跳过删除`);
        return { success: true, msg: '无需删除（未同步过 Dify）' };
      }
      await deleteDocument(post_id, difyDocId, config);
      return { success: true, msg: '文档删除成功' };
    }

    // ===== 软禁用（设为私密）=====
    if (action === 'disable') {
      if (!difyDocId) {
        console.log(`[Dify] 帖子 ${post_id} 无 dify_doc_id，跳过禁用`);
        return { success: true, msg: '无需禁用（未同步过 Dify）' };
      }
      await disableDocument(post_id, difyDocId, config);
      return { success: true, msg: '文档已禁用' };
    }

    // ===== 重新启用（从私密恢复公开）=====
    if (action === 'enable') {
      if (!difyDocId) {
        console.log(`[Dify] 帖子 ${post_id} 无 dify_doc_id，跳过启用`);
        return { success: true, msg: '无需启用（未同步过 Dify）' };
      }
      await enableDocument(post_id, difyDocId, config);
      return { success: true, msg: '文档已启用' };
    }

    // ===== 自动判断 create / update =====
    if (!difyDocId) {
      const docId = await createDocument(post, post_id, config);
      return { success: true, msg: '文档创建成功', dify_doc_id: docId };
    } else {
      await updateDocument(post, post_id, difyDocId, config);
      return { success: true, msg: '文档更新成功' };
    }

  } catch (err) {
    console.error(`[Dify] 同步失败, post=${post_id}:`, err.message);

    try {
      await db.collection('community_posts').doc(post_id).update({
        data: { pipeline_status: 'sync_failed' }
      });
    } catch (dbErr) {
      console.error('[Dify] 标记 sync_failed 失败:', dbErr.message);
    }

    return { success: false, msg: `同步失败: ${err.message}` };
  }
};
