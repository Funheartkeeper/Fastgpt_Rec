import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Box } from '@chakra-ui/react';
import mermaid from 'mermaid';
import MyIcon from '@fastgpt/web/components/common/Icon';

const mermaidAPI = mermaid.mermaidAPI;
mermaidAPI.initialize({
  startOnLoad: true,
  theme: 'base',
  flowchart: {
    useMaxWidth: false,
    nodeSpacing: 20,
    rankSpacing: 30,
    curve: 'basis'
  },
  themeVariables: {
    fontSize: '14px',
    primaryColor: '#d6e8ff',
    primaryTextColor: '#485058',
    primaryBorderColor: '#fff',
    lineColor: '#5A646E',
    secondaryColor: '#B5E9E5',
    tertiaryColor: '#485058'
  }
});

const punctuationMap: Record<string, string> = {
  '，': ',',
  '；': ';',
  '。': '.',
  '：': ':',
  '！': '!',
  '？': '?',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '【': '[',
  '】': ']',
  '（': '(',
  '）': ')',
  '《': '<',
  '》': '>',
  '、': ','
};

// 检查 mermaid 代码是否完整
function isMermaidCodeComplete(code: string) {
  // 检查括号成对
  const stack = [];
  for (const char of code) {
    if (char === '[') stack.push('[');
    if (char === ']') {
      if (stack.pop() !== '[') return false;
    }
    if (char === '(') stack.push('(');
    if (char === ')') {
      if (stack.pop() !== '(') return false;
    }
    if (char === '{') stack.push('{');
    if (char === '}') {
      if (stack.pop() !== '{') return false;
    }
  }
  if (stack.length !== 0) return false;

  // 检查每一行是否完整
  const lines = code.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines) {
    // 注释或空行跳过
    if (line.startsWith('%') || line.startsWith('%%')) continue;
    // 完整的节点定义，如 A[xxx]
    if (/^[A-Za-z0-9_]+\s*\[.*\]$/.test(line)) continue;
    // 完整的连接语句，如 A --> B[xxx] 或 A --> B
    if (/^[A-Za-z0-9_]+\s*--?>\s*[A-Za-z0-9_]+(\s*\[.*\])?$/.test(line)) continue;
    // flowchart LR 等声明也算完整
    if (/^(flowchart|graph)\s+/.test(line)) continue;
    // 其它情况视为不完整
    return false;
  }
  return true;
}

const MermaidBlock = ({ code }: { code: string }) => {
  // console.log('[MermaidBlock] 渲染，收到的 code:', code);
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [renderedCode, setRenderedCode] = useState('');

  useEffect(() => {
    // 只有在完整时才渲染
    if (isMermaidCodeComplete(code)) {
      setRenderedCode(code);
    }
  }, [code]);

  useEffect(() => {
    (async () => {
      if (!renderedCode) return;
      // console.log('[MermaidBlock] useEffect 触发，准备渲染 mermaid');
      try {
        let formatCode = renderedCode.replace(
          new RegExp(`[${Object.keys(punctuationMap).join('')}]`, 'g'),
          (match) => punctuationMap[match]
        );
        // console.log('[MermaidBlock] 标点符号替换后:', formatCode);

        // 自动给所有节点定义添加双引号包裹
        formatCode = formatCode.replace(
          /([A-Za-z0-9_]+)\s*\[([^\]]+)\]/g,
          '$1["$2"]'
        );
        // console.log('[MermaidBlock] 添加双引号后:', formatCode);
        
        const { svg } = await mermaid.render(`mermaid-${Date.now()}`, formatCode);
        setSvg(svg);
        // console.log('[MermaidBlock] mermaid 渲染成功');
      } catch (e: any) {
        console.log('[Mermaid] ', e?.message);
      }
    })();
  }, [renderedCode]);

  const onclickExport = useCallback(() => {
    // console.log('[MermaidBlock] 点击导出');
    const svg = ref.current?.children[0];
    if (!svg) return;

    const rate = svg.clientHeight / svg.clientWidth;
    const w = 3000;
    const h = rate * w;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 绘制白色背景
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ref.current?.innerHTML)}`;

    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);

      const jpgDataUrl = canvas.toDataURL('image/jpeg', 1);
      const a = document.createElement('a');
      a.href = jpgDataUrl;
      a.download = 'mermaid.jpg';
      document.body.appendChild(a);
      a.click();
      document.body?.removeChild(a);
    };
    img.onerror = (e) => {
      console.log(e);
    };
  }, []);

  return (
    <Box
      position={'relative'}
      _hover={{
        '& > .export': {
          display: 'block'
        }
      }}
    >
      <Box
        overflowX={'auto'}
        ref={ref}
        minW={'100px'}
        minH={'50px'}
        py={4}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <MyIcon
        className="export"
        display={'none'}
        name={'export'}
        w={'20px'}
        position={'absolute'}
        color={'myGray.600'}
        _hover={{
          color: 'primary.600'
        }}
        right={0}
        top={0}
        cursor={'pointer'}
        onClick={onclickExport}
      />
    </Box>
  );
};

export default MermaidBlock;
