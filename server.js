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
        // clientをchromeに変更することで、文字化けを防ぎ、解析しやすいJSON形式で取得します
        const url = `https://suggestqueries.google.com/complete/search?client=chrome&ds=yt&hl=ja&q=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        
        // client=chromeの場合、response.dataにサジェスト結果の配列が直接入っています
        if (response.data && Array.isArray(response.data)) {
            const suggestions = response.data;
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

app.get('/api/ytdlpstream', async (req, res) => {
    const videoId = req.query.v;
    if (!videoId) {
        return res.status(400).json({ error: '動画ID (v) が必要です。' });
    }

    try {
        const ytdlpUrl = `https://ytdlpinstance-vercel.vercel.app/stream/${videoId}?f=18`;
        const response = await axios.get(ytdlpUrl, { timeout: 10000 });
        
        let streamUrl = "";
        let allFormats = []; // 全画質情報を保持するための変数を追加
        if (response.data && response.data.formats) {
            allFormats = response.data.formats; // 全フォーマットを代入
            const format18 = response.data.formats.find(f => f.itag === "18" || f.itag === 18);
            if (format18) {
                streamUrl = format18.url;
            }
        }

        if (streamUrl) {
            // 既存のstreamUrlを維持しつつ、全フォーマット(allFormats)をレスポンスに含めます
            res.json({ 
                streamUrl: streamUrl,
                formats: allFormats 
            });
        } else {
            res.status(404).json({ error: 'ストリームURLが見つかりませんでした。' });
        }
    } catch (error) {
        console.error('yt-dlp Stream API Error:', error.message);
        res.status(500).json({ error: 'ストリームURLの取得に失敗しました。' });
    }
});

app.get('/api/m3u8', async (req, res) => {
    const videoId = req.query.v;

    if (!videoId) {
        return res.status(400).json({ error: "動画ID (v) が指定されていません" });
    }

    const proxyUrl = `https://meu8.vercel.app/m3u8/${encodeURIComponent(videoId)}`;

    try {
        console.log(`[m3u8] Requesting: ID=${videoId}`);
        
        const response = await axios.get(proxyUrl, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
            return res.status(500).json({ error: "外部API(GAS)側でエラーページが返されました。" });
        }

        // データの形式チェック
        const streams = response.data;
        if (!Array.isArray(streams) || streams.length === 0) {
            return res.status(404).json({ error: "有効なストリームが見つかりませんでした。" });
        }

        // ブラウザ側でのキャッシュを防ぐ設定を追加してレスポンス
        res.setHeader('Cache-Control', 'no-cache');
        res.json(streams);

    } catch (error) {
        console.error('m3u8 API Error:', error.message);
        res.status(500).json({ error: 'ストリーム取得中に通信エラーが発生しました。' });
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

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
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
