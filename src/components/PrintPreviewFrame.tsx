import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PrintTemplateJob } from '../printTemplates/types';

interface PrintPreviewFrameProps {
  job: PrintTemplateJob;
  title: string;
  onPageCountChange?: (count: number) => void;
}

const SHEET_FORMATS = new Set(['A4', 'A5', 'Custom']);

export const PrintPreviewFrame: React.FC<PrintPreviewFrameProps> = ({
  job,
  title,
  onPageCountChange,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isSheet = SHEET_FORMATS.has(job.template.format);
  const widthMm = job.pageSize.width / 1000;
  const heightMm = job.pageSize.height / 1000;
  const [frameHeightPx, setFrameHeightPx] = useState<number | null>(null);

  useEffect(() => {
    setFrameHeightPx(null);
    onPageCountChange?.(1);
  }, [job.html, job.pageSize.width, job.pageSize.height, onPageCountChange]);

  const paginatePreview = useCallback(async () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !doc.body) return;

    await doc.fonts?.ready;
    const images = Array.from(doc.images || []);
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            })
      )
    );

    if (!isSheet) {
      const thermalRoot = doc.querySelector<HTMLElement>('[data-print-document]');
      const thermalBodyStyle = doc.defaultView?.getComputedStyle(doc.body);
      const tPadTop = Number.parseFloat(thermalBodyStyle?.paddingTop || '0') || 0;
      const tPadBottom = Number.parseFloat(thermalBodyStyle?.paddingBottom || '0') || 0;
      const contentHeight = thermalRoot
        ? Math.ceil(thermalRoot.getBoundingClientRect().height + tPadTop + tPadBottom) + 4
        : Math.ceil(doc.body.scrollHeight);
      if (contentHeight > 0) setFrameHeightPx(contentHeight);
      onPageCountChange?.(1);
      return;
    }

    const root = doc.querySelector<HTMLElement>('[data-print-document]');
    if (!root) return;

    const bodyStyle = doc.defaultView?.getComputedStyle(doc.body);
    const padTop = Number.parseFloat(bodyStyle?.paddingTop || '0') || 0;
    const padRight = Number.parseFloat(bodyStyle?.paddingRight || '0') || 0;
    const padBottom = Number.parseFloat(bodyStyle?.paddingBottom || '0') || 0;
    const padLeft = Number.parseFloat(bodyStyle?.paddingLeft || '0') || 0;

    // Measure exact CSS mm -> px conversion inside the iframe
    const probe = doc.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:${widthMm}mm;height:${heightMm}mm;pointer-events:none;`;
    doc.body.appendChild(probe);
    const probeRect = probe.getBoundingClientRect();
    probe.remove();

    const pageWidthPx = probeRect.width || (widthMm * 96) / 25.4;
    const pageHeightPx = probeRect.height || (heightMm * 96) / 25.4;
    const printableHeightPx = Math.max(80, pageHeightPx - padTop - padBottom);

    const rootRect = root.getBoundingClientRect();
    const totalContentHeight = rootRect.height;

    const outerTable = root.querySelector<HTMLTableElement>(':scope > table');
    const outerThead = outerTable?.querySelector<HTMLTableSectionElement>(':scope > thead') ?? null;
    const headerRect = outerThead?.getBoundingClientRect();
    const headerHeight =
      headerRect && headerRect.height > 0 && headerRect.height < printableHeightPx * 0.45
        ? headerRect.height
        : 0;

    // Collect indivisible blocks (table rows, service cards, sections) to avoid slicing mid-row
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>('tbody > tr, article, section')
    )
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          top: rect.top - rootRect.top,
          bottom: rect.bottom - rootRect.top,
          height: rect.height,
        };
      })
      .filter(
        (box) =>
          box.height > 4 &&
          box.height < printableHeightPx * 0.85 &&
          box.top >= 0 &&
          box.bottom <= totalContentHeight + 2
      )
      .sort((a, b) => a.top - b.top);

    const slices: Array<{ start: number; end: number; includeHeader: boolean }> = [];
    let cursor = 0;
    let pageIndex = 0;
    const maxPages = 25;

    while (cursor < totalContentHeight - 2 && pageIndex < maxPages) {
      const includeHeader = pageIndex > 0 && headerHeight > 0;
      const availableHeight = Math.max(40, printableHeightPx - (includeHeader ? headerHeight : 0));
      const targetEnd = cursor + availableHeight;

      let sliceEnd = targetEnd;
      if (targetEnd >= totalContentHeight - 2) {
        sliceEnd = totalContentHeight;
      } else {
        // If any indivisible row/card straddles targetEnd, break cleanly right before it
        let cleanBreak: number | null = null;
        for (const box of candidates) {
          if (box.top > cursor + 24 && box.top < targetEnd && box.bottom > targetEnd + 1) {
            if (cleanBreak === null || box.top < cleanBreak) {
              cleanBreak = box.top;
            }
          }
        }
        if (cleanBreak !== null && cleanBreak > cursor + 24) {
          sliceEnd = cleanBreak;
        }
      }

      if (sliceEnd <= cursor + 10) {
        sliceEnd = Math.min(totalContentHeight, targetEnd);
      }

      slices.push({ start: cursor, end: sliceEnd, includeHeader });
      cursor = sliceEnd;
      pageIndex += 1;
    }

    if (slices.length === 0) {
      slices.push({ start: 0, end: totalContentHeight, includeHeader: false });
    }

    const totalPages = slices.length;
    onPageCountChange?.(totalPages);

    const isFlyErp = job.template.variant === 'flyerp';
    const rootCloneSource = root.cloneNode(true) as HTMLElement;
    const theadCloneSource = outerThead ? (outerThead.cloneNode(true) as HTMLElement) : null;

    // Build paginated sheets inside the preview document
    const container = doc.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 4px 0 12px 0;
      background: transparent;
      width: 100%;
    `;

    slices.forEach((slice, idx) => {
      const pageNum = idx + 1;
      const sheet = doc.createElement('div');
      sheet.style.cssText = `
        position: relative;
        width: ${pageWidthPx}px;
        height: ${pageHeightPx}px;
        background: #ffffff;
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
        padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;
        overflow: hidden;
        box-sizing: border-box;
      `;

      if (slice.includeHeader && theadCloneSource) {
        const headerWrapper = rootCloneSource.cloneNode(false) as HTMLElement;
        headerWrapper.removeAttribute('data-print-document');
        headerWrapper.style.margin = '0';
        const headerTable = doc.createElement('table');
        headerTable.style.cssText = 'width: 100%; border-collapse: collapse; margin: 0;';
        headerTable.appendChild(theadCloneSource.cloneNode(true));
        headerWrapper.appendChild(headerTable);
        sheet.appendChild(headerWrapper);
      }

      const viewport = doc.createElement('div');
      viewport.style.cssText = `
        width: 100%;
        height: ${Math.max(0, slice.end - slice.start)}px;
        overflow: hidden;
        position: relative;
      `;

      const contentCopy = rootCloneSource.cloneNode(true) as HTMLElement;
      contentCopy.style.transform = `translateY(-${slice.start}px)`;
      contentCopy.style.transformOrigin = 'top left';
      viewport.appendChild(contentCopy);
      sheet.appendChild(viewport);

      if (isFlyErp) {
        const pageFooter = doc.createElement('div');
        pageFooter.textContent = `Page ${pageNum} / ${totalPages}`;
        pageFooter.style.cssText = `
          position: absolute;
          left: 0;
          right: 0;
          bottom: ${Math.max(4, padBottom * 0.25)}px;
          text-align: center;
          font-family: "Cairo", "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif;
          font-size: 8.5pt;
          font-weight: 700;
          color: #64748b;
          pointer-events: none;
        `;
        sheet.appendChild(pageFooter);
      }

      container.appendChild(sheet);
    });

    doc.documentElement.style.cssText = `margin:0;padding:0;width:${pageWidthPx + 24}px;background:transparent;overflow:hidden;`;
    doc.body.style.cssText = `margin:0;padding:0;width:${pageWidthPx + 24}px;min-height:0;background:transparent;overflow:hidden;`;
    doc.body.innerHTML = '';
    doc.body.appendChild(container);

    const finalHeight = Math.ceil(container.getBoundingClientRect().height) + 8;
    setFrameHeightPx(finalHeight);
  }, [heightMm, isSheet, job.template.variant, onPageCountChange, widthMm]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      srcDoc={job.html}
      onLoad={() => void paginatePreview()}
      className={isSheet ? 'shrink-0 bg-transparent' : 'shrink-0 bg-white shadow-xl'}
      style={{
        width: isSheet ? `calc(${widthMm}mm + 24px)` : `${widthMm}mm`,
        height: frameHeightPx ? `${frameHeightPx}px` : isSheet ? `${heightMm}mm` : '420px',
        border: 0,
      }}
    />
  );
};
