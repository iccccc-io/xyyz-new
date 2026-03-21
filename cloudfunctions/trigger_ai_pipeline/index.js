const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const QWEN_API_KEY = 'sk-53aeb563514d44bc92e438a001d20310';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

exports.main = async (event, context) => {
  const { post_id } = event;
  if (!post_id) return { success: false, msg: '缺少 post_id 参数' };

  try {
    // 1. 获取帖子详情
    const postRes = await db.collection('community_posts').doc(post_id).get();
    const post = postRes.data;

    // 检查管线状态，防止重复执行
    if (post.pipeline_status !== 'pending') {
      return { success: false, msg: '该帖子管线状态不为 pending' };
    }

    // 更新状态为处理中
    await db.collection('community_posts').doc(post_id).update({
      data: { pipeline_status: 'processing' }
    });

    const images = post.images || [];
    const content = post.content || '无配文';

    // 提取关联的非遗项目名称
    let related_names = '';
    if (post.related_projects && post.related_projects.length > 0) {
      related_names = post.related_projects.map(p => p.name).join('、');
    } else {
      related_names = '未关联特定项目';
    }

    // 2. 提取需要处理的 cloud:// 图片 ID 列表
    const fileList = [];
    images.forEach((img) => {
      if (img.process_status === 0 && img.url.startsWith('cloud://')) {
        fileList.push(img.url);
      }
    });

    // 如果没有需要处理的图片，直接进入 Dify 同步
    if (fileList.length === 0) {
      console.log('[管线] 无待处理图片，直接进入 Dify 同步');
      try {
        await cloud.callFunction({
          name: 'sync_dify_knowledge',
          data: { post_id: post_id }
        });
      } catch (syncErr) {
        console.error('调用 Dify 同步云函数失败:', syncErr);
        await db.collection('community_posts').doc(post_id).update({
          data: { pipeline_status: 'sync_failed' }
        });
      }
      return { success: true, msg: '无待处理图片，已移交 Dify 同步管线' };
    }

    // 3. 将 cloud:// 转换为 https:// 临时链接
    const tempUrlRes = await cloud.getTempFileURL({ fileList: fileList });
    const tempUrlMap = {};
    tempUrlRes.fileList.forEach(item => {
      if (item.status === 0) {
        tempUrlMap[item.fileID] = item.tempFileURL;
      }
    });

    // 4. 串行调用大模型解析图片（控制并发，防止被阿里限流）
    for (let i = 0; i < images.length; i++) {
      const img = images[i];

      if (img.process_status !== 0) continue;

      const tempUrl = tempUrlMap[img.url];
      if (!tempUrl) {
        await updateImageStatus(post_id, i, -1, '获取临时链接失败');
        continue;
      }

      const systemPrompt = `你是一个专业的非遗社区运营专家。你收到的是用户发布的帖子中的配图，结合用户配文：【${content}】以及该帖子关联的非遗项目：【${related_names}】，分析这张图片。
任务：用一句话（50字以内）精准描述图片信息。
限制：直接输出描述文本，绝不允许输出任何解释性废话（如'好的'、'这张图是'等开头）。`;

      const requestBody = {
        model: 'qwen-vl-plus',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: tempUrl } },
              { type: 'text', text: systemPrompt }
            ]
          }
        ]
      };

      try {
        const aiRes = await axios.post(QWEN_API_URL, requestBody, {
          headers: {
            'Authorization': `Bearer ${QWEN_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });

        const ai_desc = aiRes.data.choices[0].message.content.trim();

        // 5. 数据库精准回写（使用点操作符，防止覆盖）
        await updateImageStatus(post_id, i, 1, ai_desc);
        console.log(`[成功] 图片 ${i} 解析完成`);

      } catch (aiError) {
        console.error(`[失败] 图片 ${i} 解析报错:`, aiError.message);
        await updateImageStatus(post_id, i, -1, '大模型解析失败');
      }
    }

    // 6. 视觉解析结束，触发 Dify 同步
    try {
      await cloud.callFunction({
        name: 'sync_dify_knowledge',
        data: { post_id: post_id }
      });
    } catch (syncErr) {
      console.error('调用 Dify 同步云函数失败:', syncErr);
      await db.collection('community_posts').doc(post_id).update({
        data: { pipeline_status: 'sync_failed' }
      });
    }

    return { success: true, msg: '视觉解析结束，已移交 Dify 同步管线' };

  } catch (error) {
    console.error('管线全局报错:', error);
    await db.collection('community_posts').doc(post_id).update({
      data: { pipeline_status: 'failed' }
    });
    return { success: false, error: error.message };
  }
};

/**
 * 原子化更新单张图片状态（点操作符定位，绝不整体覆盖数组）
 */
async function updateImageStatus(postId, index, status, desc) {
  const updateData = {
    [`images.${index}.process_status`]: status
  };

  if (status === 1) {
    updateData[`images.${index}.ai_description`] = desc;
  }

  await db.collection('community_posts').doc(postId).update({
    data: updateData
  });
}
