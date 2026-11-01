window.STR = {
ja: {
  titleJa: "目を閉じて飛べ",
  tag: "AIは、必要なときだけ写真を見る。<br>あなたはAIより少なく見て、正しく書ける？",
  daily: "今日の3ステージ #{n}",
  how: "遊び方",
  titleNote: "論文 LOWN（KAIST）のしくみをゲームにしました。データは LLaDA-V を実際に動かして記録しています。",
  howList: "<li>AIが、<b>あなたには見えない写真</b>の説明文を書いていきます。ゲート1つが1トークン（単語や単語の一部）で、3つの道が候補です。</li>"
    + "<li>目を閉じている間は、<b class='k-lk'>写真なしでAIが立てた予想（光る枠）</b>しか見えません。何もしなければ飛行機は予想の道へ進みます。<span class='key'>👁</span> で写真を見れば正しい道がわかりますが、計算コストがかかります。</li>"
    + "<li>予想が<b class='k-mem'>前に見たときの記憶 ◆</b>と同じなら<b class='k-ok'>緑</b>、違えば<b class='k-ng'>赤く点滅</b>。赤は見るべき合図です。<span class='key'>◀ ▶</span> で自分で道を選ぶこともできます。</li>"
    + "<li>スコアは<b>見た回数 + ミス×3</b>。少ないほうが勝ち。ゴースト機は <b class='k-lk'>LOWN の判定</b>で飛びます。</li>"
    + "<li style='color:#6c75a3'>キーボード ← → で道、スペースで見る。スマホは上スワイプでも見られます。</li>",
  gotIt: "わかった",
  lv: "LV {n}", lvOf: "STAGE {n}/{m}",
  inLead: "AIが写真について答えを書きます。写真はあなたには見えません。<br><span class='k-lk'>光る枠</span> 写真なしの予想　<span class='k-ok'>緑</span> 記憶と一致　<span class='k-ng'>赤の点滅</span> 見るべき　<span class='k-mem'>◆</span> 前に見た答え<br><small>日本語で聞くと英語が混ざったので、答えは英語です。</small>",
  tipCert: "緑：予想が記憶と一致。たいてい信じてよい",
  tipWarn: "赤の点滅：予想が記憶と違う。👁 で見るべき？",
  costNote: "スコア ＝ 見た回数 ＋ ミス×{p}（あなた {me}、LOWN {ai}）。",
  inN: "{n} トークン", speed1: "ふつう", speed2: "はやい", speed3: "とてもはやい",
  go: "目を閉じて出発",
  hintNoMem: "まだ一度も写真を見ていない。予想だけで行く？",
  hintCert: "予想と記憶が一致。たいてい信じてよい",
  hintDiff: "予想と記憶が食い違っている。見るべき？",
  hintLooked: "写真を見た。正しい道へ",
  memLabel: "記憶", memNow: "いま見た", memAge: "{n} 個前に見た", memNone: "まだ見ていない",
  you: "あなた", always: "毎回見る",
  computeNote: "バーは計算量。画像ありの計算を毎回した場合を100%として、Mac で測った1回あたりの GPU 計算時間から出しています。画像なしの予想は毎ステップ走ります。実際の待ち時間ではありません。",
  vWin: "LOWN に勝った！", vTie: "LOWN と引き分け", vLose: "LOWN の勝ち",
  aiWrote: "AI（毎回見た場合）：", youWrote: "あなたの文:",
  next: "次のステージへ", seeAll: "結果を見る",
  finalTag: "今日の結果",
  fWin: "今日はAIより上手に目を閉じられた", fTie: "今日はAIと互角", fLose: "今日はAIの勝ち。明日また挑戦",
  share: "結果をシェア", copied: "コピーしました", again: "もう一度", learnBtn: "しくみを読む",
  l1h: "このゲームのしくみ",
  l1: "<p>LLaDA-V は、文章を左から順に書くのではなく、全部を空欄 [MASK] にした状態から少しずつ埋めていく<b>拡散型</b>の視覚言語モデルです。1ステップごとに入力を全部読み直すので、写真のトークンを毎回処理するコストがとても大きくなります。</p>"
    + "<table><tr><th>ゲーム</th><th>論文の LOWN</th></tr>"
    + "<tr><td>ゲート1つ</td><td>1ステップ（空欄を1つ埋める）</td></tr>"
    + "<tr><td>3つの道</td><td>そのステップでモデルが考えた上位の候補</td></tr>"
    + "<tr><td>点線の道</td><td>画像なしの安い推論（text-only pass）の予想</td></tr>"
    + "<tr><td>◆ 記憶</td><td>最後に画像ありで推論したときの予想</td></tr>"
    + "<tr><td>緑になる</td><td>予想と記憶が一致した状態（certified）。画像を見ずに確定してよい</td></tr>"
    + "<tr><td>👁 見る</td><td>画像ありの重い推論をして、記憶を更新する</td></tr></table>",
  l2h: "LOWN とは",
  l2: "<p>KAIST の Donghyeon Cho、Joowon Kim、Seungho Shin、Eunho Yang による論文「Look Only When Needed」（arXiv 2610.36671）。各ステップで、まず画像なしの安い推論で空欄を予想し、最後に画像を見たときの予想と比べます。一致した語は確信度の高い順に、最初に食い違う手前まで確定し、確定できた数だけそのステップで埋めます。食い違ったときだけ画像ありの推論をします。学習もしきい値の調整も要りません。</p>"
    + "<p>著者の報告では、LLaDA-V の10個のベンチマークで元のスコアの 99.6% を保ちながら、デコードの FLOPs を平均 35.3% に減らしました<span class='lab'>著者報告</span>。画像を外しても埋める語が変わるステップは平均 22.8%、少ないものでは 7.9% しかないことが出発点です<span class='lab'>著者報告</span>。</p>",
  l3h: "このゲームのデータ（実測）",
  l3: "<p>{model} を Apple M4 Pro で実際に動かし、写真 {items} 枚を記録しました。毎回画像を見る通常の生成を1ステップ1トークンで進め、各ステップで画像なしの推論も同時に走らせています。ゲームに出るのは、句読点と文末トークンを除いた {steps} ステップです。</p>"
    + "<ul><li>画像なしの予想が、画像ありと違う語を選んだステップ: <b>{differ}%</b></li>"
    + "<li>同じ記録の上で LOWN のルールが画像を見たステップ: <b>{looks}%</b></li>"
    + "<li>毎回見た記録の上で LOWN の判定を再生し、全ステップで同じ語になった問題: <b>{same} / {items}</b></li></ul>"
    + "<p>この数字はこのページの中で記録データから計算しています。条件は論文と違います。画像は 384 px の1タイルだけ（論文は anyres_max_4）、質問は英語の一文キャプションだけで各12トークン、メモリが足りないので重みは1層ずつディスクから読み込みました。入力のうち画像のトークンは約 {imgShare}% で、論文の 89〜97% の範囲に入っています。論文の数字とは直接比べられません。</p>",
  l4h: "ゲームのために簡単にしたところ",
  l4: "<ul><li>論文は確定できた語をまとめて何個も埋めますが、ゲームは1ゲート1語にしています。</li>"
    + "<li>道の並びは、毎回画像を見た場合の生成の順番に固定しています。あなたが見たタイミングで記憶は変わりますが、空欄の埋まる順番は変わりません。</li>"
    + "<li>計算量のバーは論文の FLOPs ではなく、Mac で測った1回あたりの時間の比です。</li>"
    + "<li>ゴースト機は LOWN の判定（予想と記憶が一致すれば信じ、違えば見る）を使いますが、どの空欄を埋めるかの順番は毎回見た記録に従います。本物の LOWN のデコードではありません。</li><li>道に出る候補はトークンなので、単語の一部（例: craw と ls）が1つのゲートになることがあります。句読点は自動で入ります。</li></ul>",
  l5h: "出典と写真のクレジット",
  l5: "<ul><li><a href='https://arxiv.org/abs/2610.36671' target='_blank' rel='noopener'>Look Only When Needed: Certificate-Guided Visual Routing for Efficient Diffusion VLMs</a>（arXiv 2610.36671）</li>"
    + "<li><a href='https://hyeon9698.github.io/LOWN/' target='_blank' rel='noopener'>LOWN プロジェクトページ</a>、<a href='https://github.com/hyeon9698/LOWN' target='_blank' rel='noopener'>コード</a></li>"
    + "<li><a href='https://huggingface.co/GSAI-ML/LLaDA-V' target='_blank' rel='noopener'>LLaDA-V</a></li>"
    + "<li><a href='https://github.com/guoziyu415/fly-blind' target='_blank' rel='noopener'>このゲームのコード（GitHub）</a></li></ul><p>写真はウィキメディア・コモンズの自由なライセンスのもので、縮小して使っています（最大 768 px）。各写真のライセンスは以下のとおりで、CC BY-SA の写真は縮小版も同じライセンスです。ゲームのコードの MIT ライセンスは写真には適用されません。</p>",
  foot: "Code415 · <a href='https://code415.dev'>code415.dev</a> · 記録データとゲームのコードは GitHub で公開しています。"
},
en: {
  titleJa: "目を閉じて飛べ",
  tag: "The AI only looks at the picture when it needs to.<br>Can you look less and still get it right?",
  daily: "Daily #{n} · 3 stages",
  how: "How to play",
  titleNote: "A game built on LOWN, a paper from KAIST. The data comes from running LLaDA-V for real.",
  howList: "<li>The AI writes a caption for a <b>photo you can't see</b>. Each gate is one token (a word or part of one), and its three lanes are the candidates.</li>"
    + "<li>With your eyes closed you only see <b class='k-lk'>the AI's guess without the photo (the glowing frame)</b>. If you do nothing, the plane flies into that lane. Press <span class='key'>👁</span> to look at the photo and see the right lane, which costs compute.</li>"
    + "<li>When the guess matches <b class='k-mem'>your memory from the last look ◆</b> it turns <b class='k-ok'>green</b>; when they disagree it <b class='k-ng'>blinks red</b>, a sign to look. You can also steer with <span class='key'>◀ ▶</span>.</li>"
    + "<li>Score is <b>looks + 3 per mistake</b>. Lower wins. The ghost plane flies with <b class='k-lk'>LOWN's check</b>.</li>"
    + "<li style='color:#6c75a3'>Keyboard: ← → to steer, space to look. On phones, swipe up to look.</li>",
  gotIt: "Got it",
  lv: "LV {n}", lvOf: "STAGE {n}/{m}",
  inLead: "The AI answers a question about a photo. You can't see the photo.<br><span class='k-lk'>glowing frame</span> guess without the photo · <span class='k-ok'>green</span> matches memory · <span class='k-ng'>red blink</span> look! · <span class='k-mem'>◆</span> last look",
  tipCert: "Green: the guess matches your memory. Usually safe to trust",
  tipWarn: "Red blink: the guess disagrees with your memory. Look with 👁?",
  costNote: "Score = looks + {p} per mistake (you {me}, LOWN {ai}).",
  inN: "{n} tokens", speed1: "normal", speed2: "fast", speed3: "very fast",
  go: "Close your eyes and fly",
  hintNoMem: "You haven't looked yet. Trust the guess?",
  hintCert: "Guess matches memory. Usually safe to trust",
  hintDiff: "Guess and memory disagree. Look?",
  hintLooked: "You looked. Heading for the right lane",
  memLabel: "memory", memNow: "just looked", memAge: "looked {n} gates ago", memNone: "not looked yet",
  you: "You", always: "Always look",
  computeNote: "Bars show compute: 100% means running the image pass every step, using the GPU time per pass measured on a Mac. The guess without the photo runs every step. This is not wall-clock waiting time.",
  vWin: "You beat LOWN!", vTie: "Tied with LOWN", vLose: "LOWN wins",
  aiWrote: "AI, looking every step:", youWrote: "Your sentence:",
  next: "Next stage", seeAll: "See results",
  finalTag: "TODAY",
  fWin: "You flew blind better than the AI today", fTie: "Even with the AI today", fLose: "The AI wins today. Try again tomorrow",
  share: "Share result", copied: "Copied", again: "Play again", learnBtn: "How it works",
  l1h: "How the game works",
  l1: "<p>LLaDA-V is a <b>diffusion</b> vision-language model. Instead of writing left to right, it starts from a row of blanks [MASK] and fills them in step by step. It rereads the whole input at every step, so processing the photo every time is expensive.</p>"
    + "<table><tr><th>Game</th><th>LOWN paper</th></tr>"
    + "<tr><td>one gate</td><td>one step, one blank filled</td></tr>"
    + "<tr><td>three lanes</td><td>the model's top candidates at that step</td></tr>"
    + "<tr><td>dashed lane</td><td>the guess from the cheap text-only pass</td></tr>"
    + "<tr><td>◆ memory</td><td>the prediction from the last pass with the image</td></tr>"
    + "<tr><td>turns green</td><td>guess and memory agree (certified), safe to commit without the image</td></tr>"
    + "<tr><td>👁 look</td><td>run the expensive pass with the image and refresh the memory</td></tr></table>",
  l2h: "What is LOWN",
  l2: "<p>\"Look Only When Needed\" by Donghyeon Cho, Joowon Kim, Seungho Shin and Eunho Yang at KAIST (arXiv 2610.36671). At each step it first predicts the blanks with a cheap pass without the image and compares that with the prediction from the last time it looked. Agreeing tokens are committed in confidence order up to the first disagreement, and that count sets how many blanks get filled this step. Only on disagreement does it run the pass with the image. No training and no tuned threshold.</p>"
    + "<p>The authors report keeping 99.6% of LLaDA-V's score on ten benchmarks with 35.3% of the decoding FLOPs on average<span class='lab'>authors' numbers</span>. The starting point: removing the image changes the token being filled on only 22.8% of steps on average, as low as 7.9%<span class='lab'>authors' numbers</span>.</p>",
  l3h: "The data in this game, measured",
  l3: "<p>We ran {model} on an Apple M4 Pro and recorded {items} photos. Normal generation looked at the image every step and filled one token per step; at every step we also ran the pass without the image. The game shows {steps} steps, leaving out punctuation and the end-of-text token.</p>"
    + "<ul><li>Steps where the guess without the image picked a different word than the pass with it: <b>{differ}%</b></li>"
    + "<li>Steps where the LOWN rule looked at the image, on the same recordings: <b>{looks}%</b></li>"
    + "<li>Replaying LOWN's check on the always-look run, photos where every step matched: <b>{same} / {items}</b></li></ul>"
    + "<p>These numbers are computed in this page from the recorded data. The setup differs from the paper's: one 384 px image tile instead of anyres_max_4, English one-sentence captions of 12 tokens only, and weights streamed from disk one layer at a time because memory was short. Image tokens are about {imgShare}% of the input, inside the paper's 89 to 97%. Not directly comparable with the paper's numbers.</p>",
  l4h: "What the game simplifies",
  l4: "<ul><li>The paper commits several certified tokens per step; the game fills one word per gate.</li>"
    + "<li>The order of the gates follows the run that looked every step. Your looks change the memory, not the order in which blanks are filled.</li>"
    + "<li>The compute bars use the time per pass measured on the Mac, not the paper's FLOPs.</li>"
    + "<li>The ghost plane uses LOWN's check (trust when the guess matches memory, look when it doesn't), but which blank gets filled next follows the always-look run. It is not a real LOWN decode.</li><li>Lanes hold tokens, so part of a word (like craw and ls) can be its own gate. Punctuation fills in automatically.</li></ul>",
  l5h: "Sources and photo credits",
  l5: "<ul><li><a href='https://arxiv.org/abs/2610.36671' target='_blank' rel='noopener'>Look Only When Needed: Certificate-Guided Visual Routing for Efficient Diffusion VLMs</a> (arXiv 2610.36671)</li>"
    + "<li><a href='https://hyeon9698.github.io/LOWN/' target='_blank' rel='noopener'>LOWN project page</a> and <a href='https://github.com/hyeon9698/LOWN' target='_blank' rel='noopener'>code</a></li>"
    + "<li><a href='https://huggingface.co/GSAI-ML/LLaDA-V' target='_blank' rel='noopener'>LLaDA-V</a></li>"
    + "<li><a href='https://github.com/guoziyu415/fly-blind' target='_blank' rel='noopener'>This game's code on GitHub</a></li></ul><p>Photos are from Wikimedia Commons under free licenses, resized to at most 768 px. Each photo keeps its own license, listed below; resized CC BY-SA photos stay under CC BY-SA. The game's MIT license does not cover the photos.</p>",
  foot: "Code415 · <a href='https://code415.dev'>code415.dev</a> · The recorded data and the game's code are on GitHub."
}
};
