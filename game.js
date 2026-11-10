(() => {
  'use strict';
  const files = 'abcdefgh';
  const glyphs = { K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙', k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' };
  const names = { K:'King', Q:'Queen', R:'Rook', B:'Bishop', N:'Knight', P:'Pawn' };
  const values = { p:100, n:320, b:335, r:500, q:900, k:20000 };
  const initialBoard = () => [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    ...Array.from({length:4}, () => Array(8).fill('')),
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R']
  ];
  const initialState = () => ({ board:initialBoard(), turn:'w', castle:{K:true,Q:true,k:true,q:true}, ep:null, half:0, full:1 });
  let state = initialState();
  let selected = null, legalTargets = [], lastMove = null, history = [], moves = [], captures = [];
  let thinking = false, audioOn = true, aiTimer = null, gameFinished = false;

  const $ = id => document.getElementById(id);
  const boardEl = $('board');
  const coord = (r,c) => `${files[c]}${8-r}`;
  const inBounds = (r,c) => r>=0 && r<8 && c>=0 && c<8;
  const colorOf = p => p ? (p===p.toUpperCase()?'w':'b') : null;
  const opposite = c => c==='w'?'b':'w';
  const cloneState = s => ({ board:s.board.map(row=>row.slice()), turn:s.turn, castle:{...s.castle}, ep:s.ep?{...s.ep}:null, half:s.half, full:s.full });
  const isUpper = p => p && p===p.toUpperCase();

  function attacked(board, tr, tc, by) {
    const pawnSourceR = tr + (by==='w'?1:-1);
    for (const dc of [-1,1]) if (inBounds(pawnSourceR,tc+dc) && board[pawnSourceR][tc+dc] === (by==='w'?'P':'p')) return true;
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const r=tr+dr,c=tc+dc; if (inBounds(r,c) && board[r][c] === (by==='w'?'N':'n')) return true;
    }
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let r=tr+dr,c=tc+dc,dist=1;
      while(inBounds(r,c)) {
        const p=board[r][c];
        if(p){ if(colorOf(p)===by){const kind=p.toLowerCase();if(kind==='q'||(dist===1&&kind==='k')||(dr===0||dc===0?kind==='r':kind==='b'))return true;} break; }
        r+=dr;c+=dc;dist++;
      }
    }
    return false;
  }
  function kingPosition(board, color) {
    const king=color==='w'?'K':'k';
    for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(board[r][c]===king)return [r,c];
    return null;
  }
  function inCheck(s,color=s.turn) {
    const pos=kingPosition(s.board,color);
    return pos ? attacked(s.board,pos[0],pos[1],opposite(color)) : false;
  }
  function pseudoMoves(s, onlyCaptures=false) {
    const out=[], b=s.board, side=s.turn;
    const add=(r,c,nr,nc,extra={})=>{
      if(!inBounds(nr,nc))return;
      const target=b[nr][nc];
      if(target && colorOf(target)===side)return;
      if(onlyCaptures&&!target&&!extra.ep)return;
      out.push({from:[r,c],to:[nr,nc],...extra});
    };
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
      const p=b[r][c]; if(!p||colorOf(p)!==side)continue;
      const kind=p.toLowerCase(), dir=side==='w'?-1:1;
      if(kind==='p'){
        const nr=r+dir;
        if(!onlyCaptures&&inBounds(nr,c)&&!b[nr][c]){
          add(r,c,nr,c);
          if(r===(side==='w'?6:1)&&!b[nr+dir][c])add(r,c,nr+dir,c);
        }
        for(const dc of [-1,1]){
          const nc=c+dc;if(!inBounds(nr,nc))continue;
          if(b[nr][nc]&&colorOf(b[nr][nc])!==side)add(r,c,nr,nc);
          else if(s.ep&&s.ep.r===nr&&s.ep.c===nc)add(r,c,nr,nc,{ep:true});
        }
      } else if(kind==='n'){
        for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])add(r,c,r+dr,c+dc);
      } else if(kind==='k'){
        for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(dr||dc)add(r,c,r+dr,c+dc);
        if(!onlyCaptures&&!inCheck(s,side)){
          const home=side==='w'?7:0, enemy=opposite(side);
          if(r===home&&c===4){
            const kingRight=side==='w'?'K':'k', queenRight=side==='w'?'Q':'q';
            if(s.castle[kingRight]&&!b[home][5]&&!b[home][6]&&b[home][7]===(side==='w'?'R':'r')&&!attacked(b,home,5,enemy)&&!attacked(b,home,6,enemy))add(r,c,home,6,{castle:'K'});
            if(s.castle[queenRight]&&!b[home][1]&&!b[home][2]&&!b[home][3]&&b[home][0]===(side==='w'?'R':'r')&&!attacked(b,home,3,enemy)&&!attacked(b,home,2,enemy))add(r,c,home,2,{castle:'Q'});
          }
        }
      } else {
        const dirs=kind==='b'?[[-1,-1],[-1,1],[1,-1],[1,1]]:kind==='r'?[[-1,0],[1,0],[0,-1],[0,1]]:[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
        for(const [dr,dc] of dirs){let nr=r+dr,nc=c+dc;while(inBounds(nr,nc)){if(b[nr][nc]){if(colorOf(b[nr][nc])!==side)add(r,c,nr,nc);break;}if(!onlyCaptures)add(r,c,nr,nc);nr+=dr;nc+=dc;}}
      }
    }
    return out;
  }
  function applyMove(s,m) {
    const n=cloneState(s), b=n.board, [r,c]=m.from,[tr,tc]=m.to, piece=b[r][c], target=b[tr][tc];
    let captured=target || (m.ep?b[r][tc]:'');
    b[r][c]=''; if(m.ep)b[r][tc]='';
    b[tr][tc]=m.promotion ? (s.turn==='w'?m.promotion.toUpperCase():m.promotion) : piece;
    if(m.castle){const home=s.turn==='w'?7:0;if(m.castle==='K'){b[home][5]=b[home][7];b[home][7]='';}else{b[home][3]=b[home][0];b[home][0]='';}}
    if(piece==='K'){n.castle.K=false;n.castle.Q=false;} if(piece==='k'){n.castle.k=false;n.castle.q=false;}
    if(piece==='R'&&r===7&&c===0)n.castle.Q=false;if(piece==='R'&&r===7&&c===7)n.castle.K=false;
    if(piece==='r'&&r===0&&c===0)n.castle.q=false;if(piece==='r'&&r===0&&c===7)n.castle.k=false;
    if(target==='R'&&tr===7&&tc===0)n.castle.Q=false;if(target==='R'&&tr===7&&tc===7)n.castle.K=false;
    if(target==='r'&&tr===0&&tc===0)n.castle.q=false;if(target==='r'&&tr===0&&tc===7)n.castle.k=false;
    n.ep=null;if(piece.toLowerCase()==='p'&&Math.abs(tr-r)===2)n.ep={r:(r+tr)/2,c};
    n.half=piece.toLowerCase()==='p'||captured?0:n.half+1;
    if(s.turn==='b')n.full++;
    n.turn=opposite(s.turn);
    return {state:n,captured};
  }
  function legalMoves(s, from=null) {
    const candidates=pseudoMoves(s,false).filter(m=>!from||(m.from[0]===from[0]&&m.from[1]===from[1]));
    return candidates.filter(m=>{const next=applyMove(s,m).state;return !inCheck(next,s.turn);});
  }
  function allLegal(s){return legalMoves(s);}
  function evaluate(s, perspective) {
    let score=0;
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const p=s.board[r][c];if(!p)continue;
      const side=colorOf(p), kind=p.toLowerCase();
      let value=values[kind];
      const center=3.5-(Math.abs(3.5-r)+Math.abs(3.5-c))/2;
      if(kind==='p')value+=(side==='w'?(6-r):(r-1))*5;
      if('nb'.includes(kind))value+=center*9;
      if(kind==='q')value+=center*3;
      score+=(side===perspective?value:-value);
    }
    return score;
  }
  function search(s, depth, alpha, beta, perspective) {
    const list=allLegal(s);
    if(!list.length){if(inCheck(s,s.turn))return s.turn===perspective?-100000-depth:100000+depth;return 0;}
    if(depth===0)return evaluate(s,perspective);
    list.sort((a,b)=>{const cap=m=>{const t=s.board[m.to[0]][m.to[1]];return t?values[t.toLowerCase()]:m.ep?100:0;};return cap(b)-cap(a);});
    const maximizing=s.turn===perspective;
    let best=maximizing?-Infinity:Infinity;
    for(const m of list){const next=applyMove(s,m).state;const score=search(next,depth-1,alpha,beta,perspective);
      if(maximizing){best=Math.max(best,score);alpha=Math.max(alpha,best);}else{best=Math.min(best,score);beta=Math.min(beta,best);}if(beta<=alpha)break;
    }
    return best;
  }
  function chooseAIMove() {
    const list=allLegal(state);if(!list.length)return null;
    list.sort((a,b)=>Math.random()-.5);
    let best=-Infinity, choices=[];
    for(const m of list){const next=applyMove(state,m).state;const value=search(next,2,-Infinity,Infinity,'b')+(Math.random()*.12);
      if(value>best+.01){best=value;choices=[m];}else if(Math.abs(value-best)<.01)choices.push(m);
    }
    return choices[Math.floor(Math.random()*choices.length)]||list[0];
  }

  function squareName(r,c){return coord(r,c);}
  function renderBoard() {
    boardEl.innerHTML='';
    const king=kingPosition(state.board,state.turn), checked=inCheck(state);
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const square=document.createElement('button');square.type='button';square.className=`square ${(r+c)%2?'dark':'light'}`;square.setAttribute('role','gridcell');square.setAttribute('aria-label',`${squareName(r,c)}${state.board[r][c]?`, ${names[state.board[r][c].toUpperCase()]} ${colorOf(state.board[r][c])==='w'?'white':'black'}`:''}`);
      square.dataset.r=r;square.dataset.c=c;
      if(lastMove&&((lastMove.from[0]===r&&lastMove.from[1]===c)||(lastMove.to[0]===r&&lastMove.to[1]===c)))square.classList.add('last-move');
      if(selected&&selected[0]===r&&selected[1]===c)square.classList.add('selected');
      if(checked&&king&&king[0]===r&&king[1]===c)square.classList.add('in-check');
      const piece=state.board[r][c];
      if(piece){const span=document.createElement('span');span.className=`piece ${colorOf(piece)==='w'?'white':'black'}`;span.textContent=glyphs[piece];square.append(span);}
      if(r===7){const file=document.createElement('span');file.className='coord file';file.textContent=files[c];square.append(file);}
      if(c===0){const rank=document.createElement('span');rank.className='coord rank';rank.textContent=8-r;square.append(rank);}
      const target=legalTargets.find(m=>m.to[0]===r&&m.to[1]===c);
      if(target){const hint=document.createElement('i');hint.className=state.board[r][c]?'capture-ring':'legal-dot';square.append(hint);}
      square.addEventListener('click',onSquareClick);boardEl.append(square);
    }
  }
  function updateHeader() {
    const playerTurn=state.turn==='w'&&!thinking&&!gameFinished;
    $('turnIcon').textContent=state.turn==='w'?'♔':'♚';
    $('turnTitle').textContent=gameFinished?'DUEL COMPLETE':thinking?'RIVAL IS THINKING':playerTurn?'YOUR MOVE':'RIVAL’S MOVE';
    $('turnHint').textContent=gameFinished?'The arena remembers this duel':thinking?'The rival considers your next move…':playerTurn?(inCheck(state)?'Your king is under attack!':'Choose a capsule to command'):'The rival is choosing a move';
    $('opponentStatus').textContent=thinking?'CONSIDERING YOUR MOVE':playerTurn?'WAITING FOR YOUR MOVE':gameFinished?'DUEL FINISHED':'MAKING A MOVE';
    $('yourStatus').textContent=playerTurn?(inCheck(state)?'KING UNDER THREAT':'READY TO DUEL'):gameFinished?'DUEL FINISHED':'AWAITING YOUR TURN';
    $('opponentCard').classList.toggle('active-player',state.turn==='b'&&!gameFinished);
    $('yourCard').classList.toggle('active-player',playerTurn);
    $('thinking').classList.toggle('visible',thinking);
  }
  function renderCaptures() {
    const yours=captures.filter(x=>x.by==='w').map(x=>x.piece).sort((a,b)=>values[b.toLowerCase()]-values[a.toLowerCase()]);
    const rival=captures.filter(x=>x.by==='b').map(x=>x.piece).sort((a,b)=>values[b.toLowerCase()]-values[a.toLowerCase()]);
    const fill=(id,list)=>{$(id).innerHTML=list.length?list.map(p=>`<span class="captured-token ${colorOf(p)==='b'?'black-token':''}" title="${names[p.toUpperCase()]}">${glyphs[p]}</span>`).join(''):'<span class="empty-captures">No captures yet</span>';};
    fill('yourCaptures',yours);fill('rivalCaptures',rival);
  }
  function renderLog() {
    $('moveCount').textContent=String(moves.length).padStart(2,'0');
    if(!moves.length){$('moveLog').innerHTML='<div class="log-empty"><span>♜</span><b>THE DUEL HAS NOT BEGUN</b><small>Your first move will be recorded here</small></div>';return;}
    let html='';
    for(let i=0;i<moves.length;i+=2){const white=moves[i],black=moves[i+1];html+=`<div class="move-row"><span class="move-number">${String(Math.floor(i/2)+1).padStart(2,'0')}.</span><span class="move-san ${i===moves.length-1?'latest':''}">${white?white.san:'—'}</span><span class="move-san ${i+1===moves.length-1?'latest':''}">${black?black.san:''}</span></div>`;}
    $('moveLog').innerHTML=html;$('moveLog').scrollTop=$('moveLog').scrollHeight;
  }
  function render(){renderBoard();updateHeader();renderCaptures();renderLog();$('undoBtn').disabled=!moves.length||thinking;}
  function notation(m,piece,captured,check, mate, castle) {
    let text=castle?(m.castle==='K'?'O-O':'O-O-O'):`${piece.toLowerCase()==='p'?(captured?squareName(m.from[0],m.from[1])[0]:''):piece.toUpperCase()}${captured?'x':''}${squareName(m.to[0],m.to[1])}`;
    if(m.promotion)text+=`=${m.promotion.toUpperCase()}`;
    if(mate)text+='#';else if(check)text+='+';
    return text;
  }
  function playTone(capture=false) {
    if(!audioOn)return;
    try{const ctx=new (window.AudioContext||window.webkitAudioContext)(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=capture?245:390;gain.gain.setValueAtTime(.055,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.12);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.13);osc.onended=()=>ctx.close();}catch(_e){}
  }
  function executeMove(m) {
    const piece=state.board[m.from[0]][m.from[1]];
    if(piece.toLowerCase()==='p'&&(m.to[0]===0||m.to[0]===7)&&!m.promotion){openPromotion(m);return;}
    history.push(cloneState(state));
    const result=applyMove(state,m);state=result.state;
    const nextMoves=allLegal(state), check=inCheck(state), mate=check&&!nextMoves.length;
    const san=notation(m,piece,result.captured,check,mate,m.castle);
    moves.push({san,piece,captured:result.captured,by:colorOf(piece),move:m});
    if(result.captured)captures.push({piece:result.captured,by:colorOf(piece)});
    lastMove={from:m.from,to:m.to};selected=null;legalTargets=[];playTone(!!result.captured);
    if(!nextMoves.length){gameFinished=true;render();showResult(check?'mate':'stalemate');return;}
    if(state.half>=100){gameFinished=true;render();showResult('draw');return;}
    render();
    if(state.turn==='b')scheduleAI();
  }
  function onSquareClick(event) {
    if(thinking||gameFinished||state.turn!=='w')return;
    const r=Number(event.currentTarget.dataset.r),c=Number(event.currentTarget.dataset.c),piece=state.board[r][c];
    const target=legalTargets.find(m=>m.to[0]===r&&m.to[1]===c);
    if(target){executeMove(target);return;}
    if(piece&&colorOf(piece)==='w'){
      if(selected&&selected[0]===r&&selected[1]===c){selected=null;legalTargets=[];}
      else{selected=[r,c];legalTargets=legalMoves(state,selected);}
    }else{selected=null;legalTargets=[];}
    renderBoard();
  }
  function scheduleAI(){thinking=true;render();aiTimer=window.setTimeout(()=>{if(gameFinished)return;const m=chooseAIMove();thinking=false;if(m){const piece=state.board[m.from[0]][m.from[1]];if(piece==='p'&&m.to[0]===7)m.promotion='q';executeMove(m);}else{gameFinished=true;render();showResult(inCheck(state)?'mate':'stalemate');}},450);}
  function openPromotion(m) {
    const box=$('promotionChoices');box.innerHTML='';
    for(const type of ['q','r','b','n']){const btn=document.createElement('button');btn.className='promotion-choice';btn.type='button';btn.textContent=glyphs[type.toUpperCase()];btn.setAttribute('aria-label',names[type.toUpperCase()]);btn.addEventListener('click',()=>{$('promotionModal').hidden=true;executeMove({...m,promotion:type});});box.append(btn);}
    $('promotionModal').hidden=false;
  }
  function showResult(type) {
    const victory=type==='mate'&&state.turn==='b';
    $('resultTitle').textContent=type==='draw'||type==='stalemate'?'DRAW':victory?'VICTORY':'DEFEAT';
    $('resultMessage').textContent=type==='draw'?'The duel reaches a stalemate by the fifty-move rule.':type==='stalemate'?'No legal moves remain, but the king is safe. The duel is a draw.':victory?'The rival king is trapped. The arena is yours!':'Your king has fallen. Return stronger, duelist.';
    $('resultEmblem').textContent=victory?'♔':type==='draw'||type==='stalemate'?'⚖':'♚';
    $('resultModal').hidden=false;
  }
  function undo() {
    if(!moves.length)return;
    if(aiTimer){clearTimeout(aiTimer);aiTimer=null;}
    thinking=false;gameFinished=false;$('resultModal').hidden=true;$('promotionModal').hidden=true;
    let removed=0;
    do{const entry=moves.pop();state=history.pop()||initialState();if(entry&&entry.captured){const idx=captures.findIndex(x=>x.piece===entry.captured&&x.by===entry.by);if(idx>=0)captures.splice(idx,1);}removed++;}while(moves.length&&state.turn!=='w');
    selected=null;legalTargets=[];lastMove=moves.length?moves[moves.length-1].move:null;render();
  }
  function restart(){if(aiTimer)clearTimeout(aiTimer);aiTimer=null;state=initialState();selected=null;legalTargets=[];lastMove=null;history=[];moves=[];captures=[];thinking=false;gameFinished=false;$('resultModal').hidden=true;$('promotionModal').hidden=true;render();}
  $('undoBtn').addEventListener('click',undo);$('restartBtn').addEventListener('click',restart);$('playAgainBtn').addEventListener('click',restart);
  $('soundBtn').addEventListener('click',()=>{audioOn=!audioOn;$('soundBtn').classList.toggle('muted',!audioOn);$('soundBtn').textContent=audioOn?'♫':'♪';$('soundBtn').title=audioOn?'Sound on':'Sound off';});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){selected=null;legalTargets=[];$('promotionModal').hidden=true;renderBoard();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}});
  render();
})();
