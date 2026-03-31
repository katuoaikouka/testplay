const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

// サーバーのポート設定
const PORT = process.env.PORT || 3000;

// 使用するInvidiousインスタンスのリスト
const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.f5.si',
    'https://invidious.lunivers.trade',
    'https://invidious.ducks.party',
    'https://iv.melmac.space',
    'https://invidious.nerdvpn.de',
    'https://invidious.privacyredirect.com',
    'https://invidious.technicalvoid.dev',
    'https://invidious.darkness.services',
    'https://invidious.nikkosphere.com'
];

// 静的ファイル（HTML, CSS, JS）を public フォルダから配信
app.use(express.static(path.join(__dirname, 'public')));

/**
 * YouTubeの画像サーバー(i.ytimg.com)のURLに書き換える補助関数
 */
function injectYoutubeThumbnails(video) {
    if (video.videoId) {
        // 高画質なサムネイル(hqdefault)をセット
        const ytThumb = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
        
        // フロントエンドが期待する配列形式に整形
        video.videoThumbnails = [
            { quality: 'high', url: ytThumb },
            { quality: 'medium', url: `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg` }
        ];
    }
    
    // チャンネルアイコンの相対パスを絶対パスに変換
    if (video.authorThumbnails) {
        video.authorThumbnails.forEach(t => {
            if (t.url.startsWith('/')) {
                // インスタンスが特定できない場合は暫定的に一つを使用（表示用）
                t.url = `https://invidious.f5.si${t.url}`;
            }
        });
    }
    return video;
}

/**
 * 複数のインスタンスを同時に叩き、最速のレスポンスを返す補助関数
 */
async function fetchFromFastestInstance(endpoint) {
    const requests = INVIDIOUS_INSTANCES.map(instance => 
        axios.get(`${instance}/api/v1${endpoint}`, { timeout: 5000 })
    );
    // Promise.anyで最も早く成功したリクエストを取得
    const fastestResponse = await Promise.any(requests);
    return fastestResponse;
}

/**
 * 1. トレンド動画取得 API
 */
app.get('/api/trending', async (req, res) => {
    try {
        const response = await fetchFromFastestInstance('/trending?region=JP');
        // 全動画のサムネイルをYouTube直結に変換
        const data = response.data.map(video => injectYoutubeThumbnails(video));
        res.json(data);
    } catch (error) {
        console.error('Trending API Error:', error.message);
        res.status(500).json({ error: 'トレンド動画の取得に失敗しました。' });
    }
});

/**
 * 2. 動画検索 API
 */
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: '検索クエリが空です。' });
    }

    try {
        const response = await fetchFromFastestInstance(`/search?q=${encodeURIComponent(query)}&region=JP`);
        // 動画タイプのみ抽出し、サムネイルを変換
        const data = response.data
            .filter(item => item.type === 'video')
            .map(video => injectYoutubeThumbnails(video));
        res.json(data);
    } catch (error) {
        console.error('Search API Error:', error.message);
        res.status(500).json({ error: '検索の実行中にエラーが発生しました。' });
    }
});

/**
 * 3. 検索サジェスト API
 */
app.get('/api/suggestions', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.json([]);
    }

    try {
        const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=ja&q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        const match = response.data.match(/\((.*)\)/);
        if (match) {
            const data = JSON.parse(match[1]);
            const suggestions = data[1].map(item => item[0]);
            res.json(suggestions);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Suggestions API Error:', error.message);
        res.json([]); 
    }
});

/**
 * 4. 動画詳細情報取得 API
 */
app.get('/api/video/:id', async (req, res) => {
    const videoId = req.params.id;
    try {
        const response = await fetchFromFastestInstance(`/videos/${videoId}`);
        const data = injectYoutubeThumbnails(response.data);
        res.json(data);
    } catch (error) {
        console.error('Video Detail API Error:', error.message);
        res.status(500).json({ error: '動画詳細の取得に失敗しました。' });
    }
});

/**
 * 4.5 コメント取得 API (再生ページ用に追加)
 */
app.get('/api/comments/:id', async (req, res) => {
    try {
        const response = await fetchFromFastestInstance(`/comments/${req.params.id}`);
        res.json(response.data);
    } catch (error) {
        console.error('Comments API Error:', error.message);
        res.json({ comments: [] });
    }
});

/**
 * 5. HTMLルーティング
 */

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/search', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/search.html'));
});

app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/watch.html'));
});

app.get('/shorts.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/shorts.html'));
});

app.get('/history', (req, res) => {
    res.sendFile(__dirname + '/public/history.html');
});
/**
 * サーバー起動
 */
app.listen(PORT, () => {
    console.log('\n=========================================');
    console.log('   仙人チューブ NEXT サーバー起動完了');
    console.log('   (最速インスタンス自動選択モード実行中)');
    console.log(`   動作URL: http://localhost:${PORT}`);
    console.log('=========================================\n');
});
