/// <reference types="@figma/plugin-typings" />

type RectLayer = {
  type: "RECTANGLE";
  name: string;
  x: number; y: number; width: number; height: number;
  fill?: string; radius?: number; opacity?: number;
  gradient?: GradientSpec | null; imageSrc?: string;
};
type GradientSpec = {type?: "linear" | "radial"; direction: "right" | "left" | "up" | "down"; stops: {position:number;color:RGBA}[]};
type TextRun = {
  start: number; end: number; color: string;
  fontFamily: string; fontWeight: number; fontSize: number;
  lineHeight?: number; letterSpacing?: number;
  gradient?: GradientSpec | null;
};
type TextLayer = {
  type: "TEXT";
  name: string; text: string;
  x: number; y: number; width: number; height: number;
  fontSize: number; fontFamily: string; fontWeight: number;
  color: string; textAlign: "LEFT" | "CENTER" | "RIGHT";
  runs?: TextRun[];
};
type ImageLayer = {
  type: "IMAGE";
  name: string;
  x: number; y: number; width: number; height: number;
  src: string; fallbackSrc?: string;
};
type FrameLayer = {
  type: "FRAME"; id: string; parentId: string | null;
  tag: string; name: string;
  x: number; y: number; width: number; height: number;
  paddingTop?: number; paddingBottom?: number;
  radius?: number; fill?: string; opacity?: number; gradient?: GradientSpec | null; imageSrc?: string;
};
type LayerData = (RectLayer | TextLayer | ImageLayer | FrameLayer) & { parentId?: string | null };
type PluginMessage =
  | { type: "IMPORT_DOM"; payload: { width: number; height: number; layers: LayerData[]; frameName: string } }
  | { type: "CLOSE" };

figma.showUI(__html__, { width: 360, height: 680, themeColors: true });

function hexToRgb(hex: string): RGB | null {
  const value = hex.trim().replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16) / 255,
    g: parseInt(normalized.slice(2, 4), 16) / 255,
    b: parseInt(normalized.slice(4, 6), 16) / 255
  };
}

function solidPaint(hex: string, opacity = 1): SolidPaint | null {
  const color = hexToRgb(hex);
  return color
    ? { type: "SOLID", color, opacity: Math.max(0, Math.min(1, opacity)) }
    : null;
}

async function importLayers(payload: Extract<PluginMessage, { type: "IMPORT_DOM" }>["payload"]): Promise<void> {
  const frame = figma.createFrame();
  frame.name = payload.frameName || "HTML Import";
  // Keep successive slices aligned with their original document coordinates.
  frame.y = Math.max(0, Number((payload as any).chunkStart) || 0);
  frame.resize(Math.max(1, payload.width), Math.max(1, payload.height));
  frame.fills = [];
  frame.clipsContent = true; // clip each 6,000px page slice at its exact bounds

  let importedCount = 0;
  let failedImages = 0;
  let createdFrames = 1; // root frame
  let placeholders = 0;
  // The Figma API exposes fonts available to this editor, not the operating-system font filesystem.
  // Cache the list once per import and match family/style using CSS font-family fallbacks.
  const availableFonts = await figma.listAvailableFontsAsync();
  const familyStyles = new Map<string, Map<string, FontName>>();
  for (const entry of availableFonts) {
    const name = entry.fontName;
    const key = name.family.toLowerCase();
    if (!familyStyles.has(key)) familyStyles.set(key, new Map());
    familyStyles.get(key)!.set(name.style.toLowerCase(), name);
  }
  const resolveFont = (cssFamily: string, fontWeight: number): FontName | null => {
    const candidates = cssFamily.split(',').map(v => v.trim().replace(/^[\"']|[\"']$/g, '')).filter(Boolean);
    candidates.push('Pretendard', 'Pretendard Variable');
    const preferredStyles = fontWeight >= 800 ? ['ExtraBold', 'Black', 'Bold', 'SemiBold', 'Medium', 'Regular']
      : fontWeight >= 700 ? ['Bold', 'SemiBold', 'ExtraBold', 'Medium', 'Regular']
      : fontWeight >= 600 ? ['SemiBold', 'Bold', 'Medium', 'Regular']
      : fontWeight >= 500 ? ['Medium', 'Regular', 'SemiBold', 'Bold']
      : fontWeight <= 300 ? ['Light', 'ExtraLight', 'Thin', 'Regular']
      : ['Regular', 'Medium', 'Light', 'Bold'];
    for (const family of candidates) {
      const styles = familyStyles.get(family.toLowerCase());
      if (!styles) continue;
      for (const style of preferredStyles) {
        const font = styles.get(style.toLowerCase());
        if (font) return font;
      }
      const first = styles.values().next();
      if (!first.done) return first.value;
    }
    return null;
  };
  const loadedFonts = new Set<string>();
  async function loadFontSafe(request: FontName): Promise<FontName> {
    const key=request.family+'::'+request.style;
    if (loadedFonts.has(key)) return request;
    try { await figma.loadFontAsync(request); loadedFonts.add(key); return request; }
    catch {
      const fallback: FontName = resolveFont('Pretendard',400) ?? resolveFont('Inter',400) ?? availableFonts[0]?.fontName ?? {family:'Inter',style:'Regular'};
      const fallbackKey=fallback.family+'::'+fallback.style;
      if (!loadedFonts.has(fallbackKey)) { await figma.loadFontAsync(fallback); loadedFonts.add(fallbackKey); }
      return fallback;
    }
  }
  function gradientPaint(value: NonNullable<TextRun['gradient']>): GradientPaint {
    // Plugin gradientTransform is normalized to the text paint geometry.
    const transforms: Record<string, Transform> = {
      right: [[1,0,0],[0,1,0]],
      left: [[-1,0,1],[0,-1,1]],
      down: [[0,1,0],[-1,0,1]],
      up: [[0,-1,1],[1,0,0]]
    };
    return {
      type:value.type === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
      gradientTransform:transforms[value.direction] ?? transforms.right,
      gradientStops:value.stops.map(stop=>({
        position:Math.max(0,Math.min(1,stop.position)),
        color:{r:stop.color.r,g:stop.color.g,b:stop.color.b,a:stop.color.a}
      }))
    };
  }
  async function resolveImage(src: string): Promise<Image> {
    if (/^data:image\//i.test(src)) {
      const data = src.split(',')[1];
      if (!data) throw new Error('비어 있는 이미지 데이터');
      return figma.createImage(figma.base64Decode(data));
    }
    if (/^https?:\/\//i.test(src)) return await figma.createImageAsync(src);
    throw new Error('유효한 이미지 URL이 없습니다: ' + src);
  }
  async function backgroundFills(item: RectLayer | FrameLayer): Promise<Paint[]> {
    const fallback = item.fill ? solidPaint(item.fill, item.opacity ?? 1) : null;
    if (item.gradient?.stops && item.gradient.stops.length >= 2) {
      return [gradientPaint(item.gradient)];
    }
    if (item.imageSrc) {
      try {
        const image = await resolveImage(item.imageSrc);
        return [{type:'IMAGE',imageHash:image.hash,scaleMode:'FILL'}];
      } catch (error) {
        failedBackgrounds++;
        console.warn('Background image failed, using fallback fill',error);
      }
    }
    return fallback ? [fallback] : [];
  }
  let failedBackgrounds = 0;
  const missingFont: FontName | null = resolveFont('Pretendard', 400);
  const emergencyFont: FontName = resolveFont('Inter', 400) ?? availableFonts[0]?.fontName ?? {family:'Inter',style:'Regular'};
  const resolvedMissingFont = missingFont ?? emergencyFont;
  let fallbackCount = 0;
  let fallbackUnavailable = missingFont === null;
  async function addMissingImage(item: ImageLayer & {parentId?: string | null}, target: {node: FrameNode; x: number; y: number}) {
    const node = figma.createRectangle();
    node.name = '이미지 영역 (로드 실패) · ' + item.name;
    node.x = item.x - target.x;
    node.y = item.y - target.y;
    node.resize(item.width, item.height);
    node.fills = [{ type: 'SOLID', color: {r: 0.93, g: 0.94, b: 0.96} }];
    node.strokes = [{type: 'SOLID',color:{r:0.6,g:0.63,b:0.68}}];
    node.strokeWeight = 1;
    target.node.appendChild(node);
    try {
      await figma.loadFontAsync(resolvedMissingFont);
      const label = figma.createText();
      label.name = '이미지 누락 안내';
      label.fontName = resolvedMissingFont;
      label.characters = '이미지를 불러올 수 없습니다';
      label.fontSize = Math.max(8, Math.min(14, item.width / 14));
      label.textAutoResize = 'HEIGHT';
      label.resize(Math.max(1, item.width - 12), 24);
      label.x = node.x + 6;
      label.y = node.y + Math.max(0, item.height / 2 - 10);
      label.fills = [{type:'SOLID', color:{r:0.35,g:0.38,b:0.43}}];
      target.node.appendChild(label);
      importedCount++;
    } catch (error) { console.warn('Missing-image label skipped', error); }
    importedCount++;
    placeholders++;
  }
  const frameById = new Map<string, FrameNode>();
  const frameOrigin = new Map<string, {x: number; y: number}>();
  const selectParent = (parentId?: string | null): {node: FrameNode; x: number; y: number} => {
    if (!parentId) return {node: frame, x: 0, y: 0};
    const target = frameById.get(parentId);
    const origin = frameOrigin.get(parentId);
    if (!target || !origin) throw new Error('그룹 프레임 연결 실패: ' + parentId);
    return {node: target, x: origin.x, y: origin.y};
  };

  for (const item of payload.layers) {
    if (item.width <= 0 || item.height <= 0) continue;
    const target = selectParent(item.parentId);

    if (item.type === "FRAME") {
      const node = figma.createFrame();
      node.name = item.name;
      node.resize(item.width, item.height);
      node.fills = await backgroundFills(item);
      if (item.radius) node.cornerRadius = Math.max(0,item.radius);
      node.clipsContent = false;
      node.x = item.x - target.x;
      node.y = item.y - target.y;
      target.node.appendChild(node);
      frameById.set(item.id, node);
      frameOrigin.set(item.id, {x: item.x, y: item.y});
      createdFrames++;
      continue;
    }

    if (item.type === "RECTANGLE") {
      const node = figma.createRectangle();
      node.name = item.name;
      node.x = item.x - target.x;
      node.y = item.y - target.y;
      node.resize(item.width, item.height);
      node.fills = await backgroundFills(item);
      if (item.radius) node.cornerRadius = Math.max(0, item.radius);
      target.node.appendChild(node);
      importedCount++;
      continue;
    }

    if (item.type === "TEXT") {
      const requested=(item.fontFamily||'').split(',')[0].trim().replace(/^["']|["']$/g,'');
      const baseFont=await loadFontSafe(resolveFont(item.fontFamily||'',item.fontWeight) ?? emergencyFont);
      if (baseFont.family.toLowerCase() !== requested.toLowerCase()) fallbackCount++;
      const node=figma.createText();
      node.name=item.name;
      node.fontName=baseFont;
      node.characters=item.text;
      node.fontSize=Math.max(1,item.fontSize||14);
      node.textAlignHorizontal=item.textAlign;
      node.x=item.x-target.x;
      node.y=item.y-target.y;
      // Keep the owner's content width so <br> and wrapping match browser flow.
      node.resize(Math.max(1,item.width),Math.max(1,item.height));
      node.textAutoResize='HEIGHT';
      const defaultFill=solidPaint(item.color||'#1e1e1e');
      node.fills=defaultFill?[defaultFill]:[];
      const runs=(item.runs||[]) .filter(run => run.start>=0 && run.end<=item.text.length && run.end>run.start);
      for (const run of runs) {
        const requestedFont=(run.fontFamily||'').split(',')[0].trim().replace(/^["']|["']$/g,'');
        const selected=await loadFontSafe(resolveFont(run.fontFamily||'',run.fontWeight) ?? resolvedMissingFont);
        if (selected.family.toLowerCase() !== requestedFont.toLowerCase()) fallbackCount++;
        if (selected.family!==baseFont.family || selected.style!==baseFont.style) node.setRangeFontName(run.start,run.end,selected);
        if (Math.abs(run.fontSize-(item.fontSize||14)) > 0.01) node.setRangeFontSize(run.start,run.end,Math.max(1,run.fontSize));
        if (run.lineHeight && Number.isFinite(run.lineHeight)) {
          node.setRangeLineHeight(run.start,run.end,{unit:'PIXELS',value:Math.max(1,run.lineHeight)});
        }
        if (run.letterSpacing && Number.isFinite(run.letterSpacing)) {
          node.setRangeLetterSpacing(run.start,run.end,{unit:'PIXELS',value:run.letterSpacing});
        }
        if (run.gradient && run.gradient.stops.length>=2) {
          node.setRangeFills(run.start,run.end,[gradientPaint(run.gradient)]);
        } else {
          const color=solidPaint(run.color||item.color||'#1e1e1e');
          if(color)node.setRangeFills(run.start,run.end,[color]);
        }
      }
      target.node.appendChild(node);
      importedCount++;
      continue;
    }

    if (item.type === "IMAGE") {
      try {
        let image: Image;
        try {
          image = await resolveImage(item.src);
        } catch (originalError) {
          if (!item.fallbackSrc) throw originalError;
          image = await resolveImage(item.fallbackSrc);
        }
        const node = figma.createRectangle();
        node.name = item.name;
        node.x = item.x - target.x;
        node.y = item.y - target.y;
        node.resize(item.width, item.height);
        node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
        target.node.appendChild(node);
        importedCount++;
      } catch (error) {
        failedImages++;
        console.warn("이미지 레이어를 가져오지 못했습니다.", item.src, error);
        await addMissingImage(item, target);
      }
    }
  }

  if (importedCount === 0 && createdFrames <= 1) {
    frame.remove();
    throw new Error(failedImages > 0
      ? `이미지 ${failedImages}개를 불러오지 못했습니다. URL 접근 또는 이미지 포맷을 확인하세요.`
      : "변환할 레이어가 없습니다. HTML 입력을 확인하세요.");
  }
  figma.currentPage.appendChild(frame);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.notify(`가져오기 완료 · 프레임 ${createdFrames}개 / 하위 레이어 ${importedCount}개 / 폰트 대체 ${fallbackCount}개 / 대체 이미지 ${placeholders}개`);
  if (fallbackUnavailable) figma.notify('Pretendard를 사용할 수 없어 Figma에서 사용 가능한 대체 폰트를 적용했습니다.', {error: true});
  figma.ui.postMessage({ type: "SUCCESS", count: importedCount, frameCount: createdFrames, failedImages, failedBackgrounds, placeholders, fallbackCount, pretendardAvailable: !fallbackUnavailable });
}

figma.ui.onmessage = async (message: PluginMessage) => {
  try {
    if (message.type === "IMPORT_DOM") {
      await importLayers(message.payload);
    } else if (message.type === "CLOSE") {
      figma.closePlugin();
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "알 수 없는 오류";
    figma.notify(`가져오기 실패: ${messageText}`, { error: true });
    figma.ui.postMessage({ type: "ERROR", message: messageText });
  }
};
