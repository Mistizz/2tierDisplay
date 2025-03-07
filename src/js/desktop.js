(function (PLUGIN_ID) {
  'use strict';

  // プラグイン設定
  let pluginSettings = null;
  // 対象の一覧ビューID
  let targetListViewId = null;
  // フィールドマッピング
  let fieldMappings = [];
  // MutationObserverインスタンス
  let observer = null;
  // 処理中フラグ
  let isProcessing = false;
  // フィールドコードとラベルのマッピング
  let fieldCodeLabelMap = {};
  // ビューIDとビュー名のマッピング
  let viewIdNameMap = {};
  
  // 編集モード中かどうかのフラグ
  let isInEditMode = false;

  /**
   * ログを出力
   * @param {string} message - ログメッセージ
   * @param {boolean} forceOutput - 常に出力するかどうか
   */
  const debugLog = (message, forceOutput = false) => {
    if (forceOutput) {
      console.log(message);
    }
  };

  /**
   * フィールド情報を取得してマッピングを作成
   */
  const loadFieldInfo = async () => {
    try {
      // アプリのフィールド情報を取得
      const fieldsResp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', {
        app: kintone.app.getId()
      });
      
      // フィールドコードとラベル（フィールド名）のマッピングを作成
      fieldCodeLabelMap = {};
      Object.values(fieldsResp.properties).forEach(field => {
        if (field.code && field.label) {
          fieldCodeLabelMap[field.code] = field.label;
        }
      });
      
      console.log('フィールドコードとラベルのマッピング:', fieldCodeLabelMap);
      return true;
    } catch (error) {
      console.error('フィールド情報取得エラー:', error);
      return false;
    }
  };

  /**
   * プラグイン設定を読み込む
   */
  const loadPluginSettings = async () => {
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (!config || !config.settings) {
      console.log('プラグイン設定が見つかりません。');
      return false;
    }

    try {
      pluginSettings = JSON.parse(config.settings);
      
      // 一覧ビューごとの設定を使用
      const currentViewId = await getCurrentListViewId();
      const viewSettings = pluginSettings.viewSettings || {};
      
      // 現在のビュー名を取得
      const currentViewName = viewIdNameMap[currentViewId];
      
      // 現在の一覧ビューの設定を取得（IDまたは名前で検索）
      fieldMappings = viewSettings[currentViewId] || viewSettings[currentViewName] || [];
      
      // 設定が見つかった場合はログ出力
      if (fieldMappings.length > 0) {
        console.log(`一覧ビュー "${currentViewId}" (名前: "${currentViewName}") の設定を読み込みました:`, fieldMappings);
      } else {
        console.log(`一覧ビュー "${currentViewId}" (名前: "${currentViewName}") の設定が見つかりませんでした。`);
      }
      
      return true;
    } catch (error) {
      console.error('プラグイン設定の解析エラー:', error);
      return false;
    }
  };

  /**
   * 現在の一覧ビューIDを取得
   * @returns {Promise<string|null>} 一覧ビューID
   */
  const getCurrentListViewId = async () => {
    try {
      // URLからビューIDを取得
      const url = new URL(window.location.href);
      const viewId = url.searchParams.get('view');
      
      // アプリIDを取得
      const appId = kintone.app.getId();
      
      // 一覧ビュー情報を取得
      const viewsResp = await kintone.api(kintone.api.url('/k/v1/app/views', true), 'GET', {
        app: appId
      });
      
      const views = viewsResp.views;
      
      // ビューIDとビュー名のマッピングを作成
      viewIdNameMap = {};
      for (const [viewName, view] of Object.entries(views)) {
        if (view.type === 'LIST' && view.id) {
          viewIdNameMap[view.id] = viewName;
          viewIdNameMap[viewName] = view.id;
        }
      }
      
      console.log('ビューIDとビュー名のマッピング（更新）:', viewIdNameMap);
      
      // URLにビューIDがない場合（初期表示時）はデフォルトビューIDを取得
      if (!viewId) {
        return await getDefaultListViewId();
      }
      
      return viewId;
    } catch (error) {
      console.error('一覧ビューID取得エラー:', error);
      return null;
    }
  };

  /**
   * デフォルトの一覧ビューIDを取得
   * @returns {Promise<string|null>} デフォルトの一覧ビューID
   */
  const getDefaultListViewId = async () => {
    try {
      // 現在のアプリIDを取得
      const appId = kintone.app.getId();
      
      // 一覧ビュー情報を取得
      const viewsResp = await kintone.api(kintone.api.url('/k/v1/app/views', true), 'GET', {
        app: appId
      });
      
      const views = viewsResp.views;
      
      // 一覧ビューを取得し、index順にソート
      const listViews = Object.entries(views)
        .filter(([_, view]) => view.type === 'LIST')
        .map(([name, view]) => ({
          id: view.id,
          name: name,
          index: view.index || 0
        }))
        .sort((a, b) => a.index - b.index);
      
      if (listViews.length > 0) {
        // 最初の一覧ビュー（index値が最小）を使用
        const defaultViewId = listViews[0].id;
        const defaultViewName = listViews[0].name;
        console.log('デフォルトの一覧ビュー名:', defaultViewName, 'ID:', defaultViewId, 'インデックス:', listViews[0].index);
        return defaultViewId;
      }
      
      return null;
    } catch (error) {
      console.error('デフォルトビューID取得エラー:', error);
      return null;
    }
  };

  /**
   * 現在の一覧ビューが対象かどうかを判定
   * @returns {Promise<boolean>} 対象かどうか
   */
  const isTargetListView = async () => {
    if (!pluginSettings) {
      console.log('プラグイン設定が読み込まれていません');
      return false;
    }
    
    const currentViewId = await getCurrentListViewId();
    
    if (!currentViewId) {
      console.log('現在の一覧ビューIDが取得できませんでした');
      return false;
    }
    
    // 現在のビュー名を取得
    const currentViewName = viewIdNameMap[currentViewId];
    console.log('現在の一覧ビュー:', 'ID:', currentViewId, '名前:', currentViewName);
    
    // viewSettingsがある場合は、その中に現在の一覧ビューIDがあるかどうかを確認
    if (pluginSettings.viewSettings) {
      // 現在の一覧ビューIDに対応する設定があるかどうかを確認
      if (pluginSettings.viewSettings[currentViewId] && 
          Array.isArray(pluginSettings.viewSettings[currentViewId]) && 
          pluginSettings.viewSettings[currentViewId].length > 0) {
        console.log('対象の一覧ビューです（viewSettings直接一致）', '現在:', currentViewId);
        return true;
      }
      
      // 現在のビュー名で設定を探す（初期表示ビュー対応）
      if (currentViewName && pluginSettings.viewSettings[currentViewName] && 
          Array.isArray(pluginSettings.viewSettings[currentViewName]) && 
          pluginSettings.viewSettings[currentViewName].length > 0) {
        console.log('対象の一覧ビューです（viewSettings名前一致）', '現在の名前:', currentViewName);
        return true;
      }
    }
    
    console.log('対象の一覧ビューではありません', '現在:', currentViewId, '名前:', currentViewName);
    return false;
  };

  /**
   * フィールドコードからフィールドIDを取得
   * @param {string} fieldCode - フィールドコード
   * @returns {string|null} フィールドID
   */
  const getFieldIdByCode = (fieldCode) => {
    // フィールドコードに対応するフィールド名（ラベル）を取得
    const fieldLabel = fieldCodeLabelMap[fieldCode];
    
    if (!fieldLabel) {
      console.warn(`フィールドコード "${fieldCode}" に対応するラベルが見つかりません。`);
    }
    
    // ヘッダーセルからフィールドIDを取得
    const headerCells = document.querySelectorAll('.recordlist-header-cell-gaia');
    
    // フィールド名（ラベル）で完全一致するセルを探す
    if (fieldLabel) {
      for (const cell of headerCells) {
        const labelSpan = cell.querySelector('.recordlist-header-label-gaia');
        if (labelSpan && labelSpan.textContent === fieldLabel) {
          // クラス名からフィールドIDを抽出
          const classNames = cell.className.split(' ');
          for (const className of classNames) {
            if (className.startsWith('label-')) {
              console.log(`フィールド "${fieldCode}" (ラベル: "${fieldLabel}") の完全一致を見つけました, ID: ${className.replace('label-', '')}`);
              return className.replace('label-', '');
            }
          }
        }
      }
    }
    
    // フィールド名（ラベル）で部分一致するセルを探す
    if (fieldLabel) {
      for (const cell of headerCells) {
        const labelSpan = cell.querySelector('.recordlist-header-label-gaia');
        if (labelSpan && labelSpan.textContent.includes(fieldLabel)) {
          // クラス名からフィールドIDを抽出
          const classNames = cell.className.split(' ');
          for (const className of classNames) {
            if (className.startsWith('label-')) {
              console.log(`フィールド "${fieldCode}" (ラベル: "${fieldLabel}") の部分一致を見つけました: "${labelSpan.textContent}", ID: ${className.replace('label-', '')}`);
              return className.replace('label-', '');
            }
          }
        }
      }
    }
    
    // フィールドコードで完全一致するセルを探す（後方互換性のため）
    for (const cell of headerCells) {
      const labelSpan = cell.querySelector('.recordlist-header-label-gaia');
      if (labelSpan && labelSpan.textContent === fieldCode) {
        // クラス名からフィールドIDを抽出
        const classNames = cell.className.split(' ');
        for (const className of classNames) {
          if (className.startsWith('label-')) {
            console.log(`フィールドコード "${fieldCode}" の完全一致を見つけました, ID: ${className.replace('label-', '')}`);
            return className.replace('label-', '');
          }
        }
      }
    }
    
    // フィールドコードで部分一致するセルを探す（後方互換性のため）
    for (const cell of headerCells) {
      const labelSpan = cell.querySelector('.recordlist-header-label-gaia');
      if (labelSpan && labelSpan.textContent.includes(fieldCode)) {
        // クラス名からフィールドIDを抽出
        const classNames = cell.className.split(' ');
        for (const className of classNames) {
          if (className.startsWith('label-')) {
            console.log(`フィールドコード "${fieldCode}" の部分一致を見つけました: "${labelSpan.textContent}", ID: ${className.replace('label-', '')}`);
            return className.replace('label-', '');
          }
        }
      }
    }
    
    console.warn(`フィールド "${fieldCode}" のIDが見つかりませんでした。`);
    return null;
  };

  /**
   * フィールドコードからセル要素を取得
   * @param {string} fieldCode - フィールドコード
   * @returns {Array<HTMLElement>} セル要素の配列
   */
  const getCellsByFieldCode = (fieldCode) => {
    // フィールドコードからフィールドIDを取得
    const fieldId = getFieldIdByCode(fieldCode);
    if (!fieldId) {
      console.warn(`フィールド "${fieldCode}" のIDが見つかりません。`);
      return [];
    }

    // フィールドIDに対応するセルを取得
    const cells = document.querySelectorAll(`.value-${fieldId}`);
    return Array.from(cells);
  };

  /**
   * 2段表示を適用
   */
  const applyTwoTierDisplay = () => {
    if (isProcessing) return;
    if (isInEditMode) {
      debugLog('編集モード中のため2段表示を適用しません');
      return;
    }
    
    isProcessing = true;
    
    debugLog('2段表示を適用します', true);
    
    try {
      // 編集モードの場合は適用しない
      if (document.querySelector('.recordlist-editcell-gaia')) {
        debugLog('編集モード中のため2段表示を適用しません');
        isProcessing = false;
        return;
      }
      
      // 各マッピングに対して処理
      fieldMappings.forEach(mapping => {
        const upperFieldCode = mapping.upperField.code;
        const lowerFieldCode = mapping.lowerField.code;
        
        // フィールドコードからフィールドIDを取得
        const upperFieldId = getFieldIdByCode(upperFieldCode);
        const lowerFieldId = getFieldIdByCode(lowerFieldCode);
        
        if (!upperFieldId || !lowerFieldId) {
          console.warn(`フィールドIDが取得できません: 上段=${upperFieldCode}, 下段=${lowerFieldCode}`);
          return;
        }
        
        debugLog(`2段表示処理: 上段=${upperFieldCode}(ID:${upperFieldId}), 下段=${lowerFieldCode}(ID:${lowerFieldId})`);
        
        // 上段のヘッダーセルを取得
        const upperHeaderCell = document.querySelector(`.label-${upperFieldId}`);
        if (upperHeaderCell) {
          // 既に追加済みでない場合のみ処理
          if (!upperHeaderCell.querySelector('.two-tier-lower-label')) {
            // 下段のラベルを取得
            const lowerLabelCell = document.querySelector(`.label-${lowerFieldId}`);
            if (lowerLabelCell) {
              const lowerLabelSpan = lowerLabelCell.querySelector('.recordlist-header-label-gaia');
              if (lowerLabelSpan) {
                // 下段ラベル用のコンテナを作成
                const lowerLabelContainer = document.createElement('div');
                lowerLabelContainer.className = 'two-tier-lower-label';
                lowerLabelContainer.style.fontSize = '11px';
                lowerLabelContainer.style.color = '#888';
                lowerLabelContainer.style.marginTop = '4px';
                lowerLabelContainer.style.borderTop = '1px dashed #ccc';
                lowerLabelContainer.style.paddingTop = '4px';
                
                // 下段ラベルのテキストを設定
                lowerLabelContainer.textContent = lowerLabelSpan.textContent;
                
                // 上段のヘッダーセル内の適切な位置に挿入
                const headerInner = upperHeaderCell.querySelector('.recordlist-header-cell-inner-wrapper-gaia');
                if (headerInner) {
                  const headerInnerFirst = headerInner.querySelector('.recordlist-header-cell-inner-gaia');
                  if (headerInnerFirst) {
                    headerInnerFirst.appendChild(lowerLabelContainer);
                  }
                }
              }
            }
          }
        }
        
        // 上段と下段のセルを取得
        const upperCells = document.querySelectorAll(`.value-${upperFieldId}`);
        const lowerCells = document.querySelectorAll(`.value-${lowerFieldId}`);
        
        // 下段のラベル要素を取得
        const lowerLabelCells = document.querySelectorAll(`.label-${lowerFieldId}`);
        
        debugLog(`2段表示処理: 上段セル=${upperCells.length}個, 下段セル=${lowerCells.length}個, 下段ラベル=${lowerLabelCells.length}個`);
        
        // 各セルに対して処理
        upperCells.forEach((upperCell, index) => {
          // 既に処理済みの場合はスキップ
          if (upperCell.classList.contains('two-tier-processed')) {
            return;
          }
          
          // 対応する下段のセルを取得
          const lowerCell = lowerCells[index];
          if (!lowerCell) {
            console.warn(`下段セルが見つかりません: index=${index}`);
            return;
          }
          
          // 上段セルに処理済みのマーカーを追加
          upperCell.classList.add('two-tier-processed');
          
          // 下段セルをコピーして上段セルに追加
          const lowerCellClone = lowerCell.cloneNode(true);
          lowerCellClone.classList.add('two-tier-lower-cell');
          lowerCellClone.classList.add('two-tier-cloned');
          
          // コピーした下段セルのスタイルを設定
          lowerCellClone.style.marginTop = '8px';
          lowerCellClone.style.borderTop = '1px dashed #ccc';
          lowerCellClone.style.borderLeft = 'none';
          lowerCellClone.style.borderRight = 'none';
          lowerCellClone.style.paddingTop = '4px';
          lowerCellClone.style.width = '100%';
          lowerCellClone.style.display = 'block';
          lowerCellClone.style.boxSizing = 'border-box';
          lowerCellClone.style.marginLeft = '0';
          lowerCellClone.style.marginRight = '0';
          lowerCellClone.style.paddingLeft = '0';
          lowerCellClone.style.paddingRight = '0';
          lowerCellClone.style.minHeight = '32px';
          lowerCellClone.style.lineHeight = '32px';
          
          // 下段セルの内部要素のスタイルも調整
          const innerDivs = lowerCellClone.querySelectorAll('div');
          innerDivs.forEach(div => {
            div.style.width = '100%';
            div.style.boxSizing = 'border-box';
            div.style.margin = '0';
            div.style.padding = '0 8px';
            div.style.minHeight = '32px';
            div.style.lineHeight = '32px';
            
            // 省略表示用のクラスを追加
            if (div.classList.contains('line-cell-gaia')) {
              div.classList.add('recordlist-ellipsis-gaia');
              
              // ポップアップ表示用のイベントリスナーを追加
              const span = div.querySelector('span');
              if (span) {
                const originalText = span.textContent;
                
                // マウスオーバー時のポップアップ表示
                div.addEventListener('mouseover', (event) => {
                  // spanの幅を計測（実際のテキストの幅）
                  const spanWidth = span.scrollWidth;
                  // 親要素の表示可能幅
                  const containerWidth = div.clientWidth;
                  
                  console.log('マウスオーバー検知:', {
                    text: originalText,
                    textWidth: spanWidth,
                    containerWidth: containerWidth,
                    isTruncated: spanWidth > containerWidth
                  });
                  
                  // テキストが親要素より大きい場合にポップアップを表示
                  if (spanWidth > containerWidth) {
                    const popup = document.createElement('div');
                    popup.className = 'recordlist-tooltip-gaia';
                    popup.style.position = 'absolute';
                    popup.style.zIndex = '10000';
                    popup.style.backgroundColor = 'white';
                    popup.style.border = '1px solid #e3e7e8';
                    popup.style.borderRadius = '4px';
                    popup.style.padding = '8px 12px';
                    popup.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.15)';
                    popup.style.maxWidth = '400px';
                    popup.style.wordBreak = 'break-all';
                    popup.style.whiteSpace = 'pre-wrap';
                    popup.textContent = originalText;
                    
                    // ポップアップの位置を設定
                    const rect = div.getBoundingClientRect();
                    popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
                    popup.style.left = `${rect.left + window.scrollX}px`;
                    
                    // ポップアップをbodyに追加
                    document.body.appendChild(popup);
                    
                    // マウスアウト時にポップアップを削除
                    div.addEventListener('mouseout', () => {
                      popup.remove();
                    }, { once: true });
                  }
                });
              }
            }
          });
          
          // 下段セルのコピーを上段セルに追加
          upperCell.appendChild(lowerCellClone);
          
          // 元の下段セルを非表示にする
          lowerCell.style.display = 'none';
          lowerCell.classList.add('two-tier-original');
          
          // 対応する下段のラベル要素を非表示にする
          if (index < lowerLabelCells.length) {
            const lowerLabelCell = lowerLabelCells[index];
            lowerLabelCell.style.display = 'none';
            lowerLabelCell.classList.add('two-tier-original-label');
          }
          
          debugLog(`下段セル ${index + 1} をコピーして上段セルに追加し、元のセルとラベルを非表示にしました`);
        });
      });
    } catch (error) {
      console.error('2段表示の適用中にエラーが発生しました:', error);
    } finally {
      isProcessing = false;
    }
  };

  /**
   * 2段表示を解除
   */
  const resetTwoTierDisplay = () => {
    if (isProcessing) return;
    isProcessing = true;
    
    debugLog('2段表示を解除します', true);
    
    try {
      // 各マッピングに対して処理
      fieldMappings.forEach(mapping => {
        const upperFieldCode = mapping.upperField.code;
        const lowerFieldCode = mapping.lowerField.code;
        
        // フィールドコードからフィールドIDを取得
        const upperFieldId = getFieldIdByCode(upperFieldCode);
        const lowerFieldId = getFieldIdByCode(lowerFieldCode);
        
        if (!upperFieldId || !lowerFieldId) {
          console.warn(`フィールドIDが取得できません: 上段=${upperFieldCode}, 下段=${lowerFieldCode}`);
          return;
        }
        
        debugLog(`2段表示解除: 上段=${upperFieldCode}(ID:${upperFieldId}), 下段=${lowerFieldCode}(ID:${lowerFieldId})`);
        
        // 処理済みの上段セルを取得
        const processedUpperCells = document.querySelectorAll(`.value-${upperFieldId}.two-tier-processed`);
        
        // 非表示になっている元の下段セルを取得
        const originalLowerCells = document.querySelectorAll(`.value-${lowerFieldId}.two-tier-original`);
        
        // 非表示になっている元の下段ラベル要素を取得
        const originalLowerLabelCells = document.querySelectorAll(`.label-${lowerFieldId}.two-tier-original-label`);
        
        debugLog(`2段表示解除: 処理済み上段セル=${processedUpperCells.length}個, 元の下段セル=${originalLowerCells.length}個, 元の下段ラベル=${originalLowerLabelCells.length}個`);
        
        // 各セルに対して処理
        processedUpperCells.forEach((upperCell, index) => {
          // クローンされた下段セルを削除
          const clonedLowerCells = upperCell.querySelectorAll('.two-tier-cloned');
          clonedLowerCells.forEach(clonedCell => {
            clonedCell.remove();
          });
          
          // 処理済みマーカーを削除
          upperCell.classList.remove('two-tier-processed');
          
          // 対応する元の下段セルを再表示
          if (index < originalLowerCells.length) {
            const originalLowerCell = originalLowerCells[index];
            originalLowerCell.style.display = '';
            originalLowerCell.classList.remove('two-tier-original');
          }
          
          // 対応する元の下段ラベル要素を再表示
          if (index < originalLowerLabelCells.length) {
            const originalLowerLabelCell = originalLowerLabelCells[index];
            originalLowerLabelCell.style.display = '';
            originalLowerLabelCell.classList.remove('two-tier-original-label');
          }
          
          debugLog(`上段セル ${index + 1} の2段表示を解除しました`);
        });
      });
    } catch (error) {
      console.error('2段表示の解除中にエラーが発生しました:', error);
    } finally {
      isProcessing = false;
    }
  };

  /**
   * 編集モード時の処理
   * @param {Event} event - イベントオブジェクト
   */
  const handleEditMode = (event) => {
    // 既に編集モード中なら処理しない
    if (isInEditMode) return;
    
    // 編集モードフラグをON
    isInEditMode = true;
    
    // 編集モードになった場合、まず2段表示を解除
    resetTwoTierDisplay();
    
    // 少し遅延させて編集モードの処理を行う（DOMの更新が完了するのを待つ）
    setTimeout(() => {
      // 編集モードになった場合の処理
      const editModeRows = document.querySelectorAll('.recordlist-editcell-gaia');
      if (editModeRows.length === 0) {
        isInEditMode = false;
        return;
      }
      
      debugLog('編集モードを検出しました', true);
      
      // 編集中の行のインデックスを特定
      let editingRowIndex = -1;
      const rows = document.querySelectorAll('.recordlist-row-gaia');
      rows.forEach((row, idx) => {
        if (row.querySelector('.recordlist-editcell-gaia')) {
          editingRowIndex = idx;
        }
      });
      
      debugLog(`編集中の行インデックス: ${editingRowIndex}`);
      
      // 各マッピングに対して処理
      fieldMappings.forEach(mapping => {
        const upperFieldCode = mapping.upperField.code;
        const lowerFieldCode = mapping.lowerField.code;
        
        // フィールドコードからフィールドIDを取得
        const upperFieldId = getFieldIdByCode(upperFieldCode);
        const lowerFieldId = getFieldIdByCode(lowerFieldCode);
        
        if (!upperFieldId || !lowerFieldId) {
          console.warn(`フィールドIDが取得できません: 上段=${upperFieldCode}, 下段=${lowerFieldCode}`);
          return;
        }
        
        debugLog(`編集モード処理: 上段=${upperFieldCode}(ID:${upperFieldId}), 下段=${lowerFieldCode}(ID:${lowerFieldId})`);
        
        // 編集モード時の上段と下段のセルを取得
        const upperCells = document.querySelectorAll(`.value-${upperFieldId}`);
        const lowerCells = document.querySelectorAll(`.value-${lowerFieldId}`);
        
        debugLog(`編集モード処理: 上段セル=${upperCells.length}個, 下段セル=${lowerCells.length}個`);
        
        // 編集中の行のセルのみを処理
        if (editingRowIndex >= 0 && editingRowIndex < upperCells.length) {
          const upperCell = upperCells[editingRowIndex];
          const lowerCell = lowerCells[editingRowIndex];
          
          if (!lowerCell) {
            console.warn(`下段セルが見つかりません: index=${editingRowIndex}`);
            return;
          }
          
          // 下段セルが表示されていることを確認（編集モードになると自動的に表示される）
          if (lowerCell.style.display === 'none') {
            lowerCell.style.display = '';
          }
          
          // 下段セルのスタイルを設定
          lowerCell.style.marginTop = '8px';
          lowerCell.style.borderTop = '1px dashed #ccc';
          lowerCell.style.paddingTop = '4px';
          
          // 下段セルを上段セルに直接移動（この時点では元の場所から切り取る）
          upperCell.appendChild(lowerCell);
          
          debugLog(`編集モード: 下段セル ${editingRowIndex} を上段セルに移動しました`);
        } else {
          debugLog(`編集中の行インデックスが範囲外です: ${editingRowIndex}, 上段セル数: ${upperCells.length}`);
        }
      });
      
      // 編集モードが終了したときに2段表示を再適用するためのイベントリスナーを設定
      const saveButton = document.querySelector('.gaia-ui-actionmenu-save');
      if (saveButton) {
        // イベントリスナーが重複しないように一度削除
        saveButton.removeEventListener('click', handleSaveButtonClick);
        saveButton.addEventListener('click', handleSaveButtonClick);
      }
      
      // キャンセルボタンのイベントリスナーも設定
      const cancelButton = document.querySelector('.gaia-ui-actionmenu-cancel');
      if (cancelButton) {
        // イベントリスナーが重複しないように一度削除
        cancelButton.removeEventListener('click', handleCancelButtonClick);
        cancelButton.addEventListener('click', handleCancelButtonClick);
      }
    }, 300); // 遅延時間を300ミリ秒に増やす
  };

  /**
   * MutationObserverを設定
   */
  const setupObserver = () => {
    // 既存のObserverを切断
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    
    // 一覧表示のテーブルを監視
    const recordListTable = document.querySelector('.recordlist-gaia');
    if (!recordListTable) {
      console.warn('一覧表示のテーブルが見つかりません');
      return;
    }
    
    // MutationObserverの設定
    observer = new MutationObserver((mutations) => {
      let shouldApply = false;
      let isEditModeStart = false;
      let isEditModeEnd = false;
      
      // 変更内容を確認
      for (const mutation of mutations) {
        // 編集モード開始の検出
        if (mutation.type === 'childList' && 
            mutation.addedNodes.length > 0 && 
            Array.from(mutation.addedNodes).some(node => 
              node.nodeType === Node.ELEMENT_NODE && 
              (node.classList.contains('recordlist-editcell-gaia') || 
               node.querySelector('.recordlist-editcell-gaia')))) {
          isEditModeStart = true;
          break; // 編集モード開始を検出したらループを抜ける
        }
        
        // 編集モード終了の検出
        if (mutation.type === 'childList' && 
            mutation.removedNodes.length > 0 && 
            Array.from(mutation.removedNodes).some(node => 
              node.nodeType === Node.ELEMENT_NODE && 
              (node.classList.contains('recordlist-editcell-gaia') || 
               node.querySelector('.recordlist-editcell-gaia')))) {
          isEditModeEnd = true;
          shouldApply = true;
          break; // 編集モード終了を検出したらループを抜ける
        }
        
        // 一覧表示の変更を検出（編集モード開始/終了以外の変更）
        if (!isEditModeStart && !isEditModeEnd && 
            mutation.type === 'childList' && 
            (mutation.target.classList.contains('recordlist-gaia') || 
             mutation.target.classList.contains('recordlist-body-gaia'))) {
          shouldApply = true;
        }
      }
      
      // 編集モード開始時の処理
      if (isEditModeStart && !isInEditMode) {
        debugLog('編集モード開始を検出しました', true);
        handleEditMode();
      }
      
      // 編集モード終了時の処理
      if (isEditModeEnd) {
        debugLog('編集モード終了を検出しました', true);
        // 編集モードフラグをOFF
        isInEditMode = false;
        // 少し遅延させて適用（DOMの更新が完了するのを待つ）
        setTimeout(async () => {
          if (await isTargetListView()) {
            // 完全にリセットしてから再適用
            resetTwoTierDisplay();
            setTimeout(() => {
              applyTwoTierDisplay();
            }, 300);
          }
        }, 500);
      } else if (shouldApply && !isInEditMode && !document.querySelector('.recordlist-editcell-gaia')) {
        // 編集モードでない場合で、一覧表示の変更があった場合
        // 少し遅延させて適用（DOMの更新が完了するのを待つ）
        setTimeout(async () => {
          if (await isTargetListView()) {
            // 完全にリセットしてから再適用
            resetTwoTierDisplay();
            setTimeout(() => {
              applyTwoTierDisplay();
            }, 300);
          }
        }, 300);
      }
    });
    
    // 監視オプション
    const observerOptions = {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    };
    
    // 監視開始
    observer.observe(recordListTable, observerOptions);
    debugLog('MutationObserverを設定しました');
  };
  
  // 保存ボタンクリック時の処理
  const handleSaveButtonClick = () => {
    debugLog('保存ボタンがクリックされました', true);
    
    // 編集モードフラグをOFF
    isInEditMode = false;
    
    // 保存ボタンがクリックされたら、少し遅延して2段表示を再適用
    setTimeout(async () => {
      if (await isTargetListView()) {
        // 完全にリセットしてから再適用
        resetTwoTierDisplay();
        setTimeout(() => {
          applyTwoTierDisplay();
        }, 300);
      }
    }, 500);
  };
  
  // キャンセルボタンクリック時の処理
  const handleCancelButtonClick = () => {
    debugLog('キャンセルボタンがクリックされました', true);
    
    // 編集モードフラグをOFF
    isInEditMode = false;
    
    // キャンセルボタンがクリックされたら、少し遅延して2段表示を再適用
    setTimeout(async () => {
      if (await isTargetListView()) {
        // 完全にリセットしてから再適用
        resetTwoTierDisplay();
        setTimeout(() => {
          applyTwoTierDisplay();
        }, 300);
      }
    }, 500);
  };

  /**
   * カスタムスタイルを追加
   */
  const addCustomStyles = () => {
    // 既に追加済みの場合は何もしない
    if (document.getElementById('two-tier-display-styles')) {
      return;
    }
    
    // スタイル要素を作成
    const styleEl = document.createElement('style');
    styleEl.id = 'two-tier-display-styles';
    styleEl.textContent = `
      .two-tier-lower-container {
        margin-top: 8px;
        border-top: 1px dashed #ccc;
        padding-top: 4px;
      }
    `;
    
    // スタイルをドキュメントに追加
    document.head.appendChild(styleEl);
    console.log('カスタムスタイルを追加しました');
  };

  // kintoneイベント
  kintone.events.on('app.record.index.show', async (event) => {
    try {
      // プラグイン設定を読み込む
      if (!await loadPluginSettings()) {
        return event;
      }
      
      // フィールド情報を読み込む
      await loadFieldInfo();
      
      // 対象の一覧ビューかどうかを判定
      if (!await isTargetListView()) {
        return event;
      }
      
      // カスタムスタイルを追加
      addCustomStyles();
      
      // 2段表示を適用
      applyTwoTierDisplay();
      
      // MutationObserverを設定
      setupObserver();
      
      return event;
    } catch (error) {
      console.error('一覧表示処理エラー:', error);
      return event;
    }
  });

})(kintone.$PLUGIN_ID);
