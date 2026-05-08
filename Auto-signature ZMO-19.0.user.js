// ==UserScript==
// @name         Auto-signature ZMO
// @namespace    http://tampermonkey.net/
// @version      19.0
// @description  Автоматизированная подпись для ЗМО
// @author       You
// @match        https://*.zmo.fabrtech.ru/*
// @grant        none
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/575789/Auto-signature%20ZMO.user.js
// @updateURL https://update.greasyfork.org/scripts/575789/Auto-signature%20ZMO.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const REASON_TEXT = "Обоснование такое обоснование";
    const CERT_SEARCH_TERM = "Халк";
    const POA_SEARCH_TERM = "Являюсь руководителем";

    let isAutomationActive = false;

    let isModalFilled = false;
    let isCertSelected = false;
    let isPoaSelected = false;
    let isFinalSubmitDone = false;

    let activeObservers = new Set();
    let currentUrl = location.href;

    let currentStep = null; // Текущий шаг выполнения
    let timeoutId = null; // Таймер для отключения скрипта

    function log(msg) {
        if (isAutomationActive) {
            console.log(`[ZMO-AUTO] ${msg}`);
        }
    }

    // Проверка: страница подходит для авто-подписи?
    function isTargetPage() {
        const path = location.pathname;
        const searchParams = new URLSearchParams(window.location.search);

        // 1. Базовая проверка пути (должно быть edit или add или final)
        const isEdit = path.includes('/purchase_notice/edit') || path.includes('/purchase_notice_es/edit');
        const isAdd = path.includes('/purchase_notice/add') || path.includes('/purchase_notice_es/add') || path.includes('/purchase_notice/order-now');
        const isFinal = path.includes('/protocol/add-final') || path.includes('/protocol_es/add-final');

        if (!(isEdit || isAdd || isFinal)) {
            return false;
        }

        // 2. Исключение секции commerce по параметру URL
        if (searchParams.get('section') === 'commerce') {
            return false;
        }

        // 3. Исключение коммерческих закупок по значению поля "Тип закупки"
        // Ищем поле с путем typeProcedure (универсальный селектор для этого поля)
        const typeProcDropdown = document.querySelector('ef-widget-dropdown[element_path*="typeProcedure"]');

        if (typeProcDropdown) {
            const label = typeProcDropdown.querySelector('.p-dropdown-label');
            if (label) {
                const typeValue = label.textContent.trim();
                // Если тип закупки "Коммерческая", блокируем автоматизацию
                if (typeValue === 'Коммерческая') {
                    console.log('[ZMO-AUTO] Обнаружена коммерческая закупка. Авто-подпись отключена.');
                    return false;
                }
            }
        }

        return true;
    }

    // --- СБРОС ПРИ СМЕНЕ СТРАНИЦЫ (SPA) ---
    function resetState() {
        const newUrl = location.href;
        if (newUrl !== currentUrl) {
            currentUrl = newUrl;
            deactivateAutomation();
        }
    }

    function deactivateAutomation() {
        isAutomationActive = false;
        isModalFilled = false;
        isCertSelected = false;
        isPoaSelected = false;
        isFinalSubmitDone = false;
        activeObservers.clear();
        // Логируем только если были активны, чтобы не спамить при обычной навигации
        // console.log('[ZMO-AUTO] Состояние сброшено.');
    }

    const originalPushState = history.pushState;
    history.pushState = function(...args) {
        originalPushState.apply(this, args);
        resetState();
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
        originalReplaceState.apply(this, args);
        resetState();
    };
    window.addEventListener('popstate', resetState);

    // Активация таймера скрипта
    function startTimeout() {
        if (timeoutId) clearTimeout(timeoutId); // Сбрасываем предыдущий таймер
        timeoutId = setTimeout(() => {
            log('[ZMO-AUTO] Превышено время ожидания (10 сек). Отключение скрипта...');
            deactivateAutomation();
        }, 10000); // 10 секунд
    }
    // Сброс таймера
        function resetTimeout() {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
    }

    // --- 1. КНОПКА ЭЦП+ (ЖЕЛТАЯ ИКОНКА + ГОЛУБОЙ ФОН + ОДНОКРАТНАЯ ТРЯСКА) ---
    function addEcpButton() {
        if (document.querySelector('.zp-ecp-plus-trigger')) return;
        if (!isTargetPage()) return;

        let originalBtn = null;
        let widget = null;

        // ПОИСК КНОПКИ (Edit, Add, Order-Now или Final)
        widget = document.querySelector('ef-widget-button[element_path="procedure-actions.actions.save-published"]');
        if (!widget) {
            widget = document.querySelector('ef-widget-button[element_path="procedure-actions.actions.publish"]');
        }
        if (!widget) {
            widget = document.querySelector('ef-widget-button[element_path="actions.actions.publish"]'); // Для Final
        }
        if (widget) {
            originalBtn = widget.querySelector('button.p-button');
        }
        if (!originalBtn) return;

        // SVG ИКОНКА (Молния) - Желтая в покое
        const ICON_SYMBOL = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;

        const TOOLTIP_TEXT = 'Авто-заполнение и подписание (ЭЦП+)';

        const iconContainer = document.createElement('div');
        iconContainer.classList.add('zp-ecp-plus-trigger');

        // БАЗОВЫЕ СТИЛИ (Покой)
        Object.assign(iconContainer.style, {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            marginLeft: '6px',
            borderRadius: '50%',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontSize: '14px',
            color: '#f1c40f',    // ЖЕЛТЫЙ ЦВЕТ иконки
            backgroundColor: 'transparent',
            border: 'none',
            padding: '0',
            lineHeight: '1',
            opacity: '0.8'
        });

        iconContainer.innerHTML = ICON_SYMBOL;
        iconContainer.title = TOOLTIP_TEXT;

        // CSS АНИМАЦИИ
        if (!document.getElementById('zp-flash-style')) {
            const styleSheet = document.createElement("style");
            styleSheet.id = 'zp-flash-style';
            styleSheet.innerText = `
                /* Однократная тряска при наведении */
                @keyframes zpShakeOnce {
                    0% { transform: rotate(0deg) translateX(0); }
                    20% { transform: rotate(-12deg) translateX(-2px); }
                    40% { transform: rotate(12deg) translateX(2px); }
                    60% { transform: rotate(-8deg) translateX(-1px); }
                    80% { transform: rotate(8deg) translateX(1px); }
                    100% { transform: rotate(0deg) translateX(0); }
                }
                /* Вспышка (Pulse) */
                @keyframes zpFlashPulse {
                    0% { box-shadow: 0 0 0 0 rgba(0, 188, 212, 0.7); }
                    50% { box-shadow: 0 0 12px 4px rgba(0, 188, 212, 0.4); }
                    100% { box-shadow: 0 0 0 0 rgba(0, 188, 212, 0); }
                }
            `;
            document.head.appendChild(styleSheet);
        }

        const activateStyle = () => {
            // Фон становится голубым, иконка белой
            iconContainer.style.color = '#fff';
            iconContainer.style.backgroundColor = 'rgba(0, 188, 212, 0.9)'; // Cyan фон
            iconContainer.style.opacity = '1';

            // Запускаем тряску ТОЛЬКО ОДИН РАЗ (forwards оставляет финальное состояние)
            iconContainer.style.animation = 'zpShakeOnce 0.4s ease-out forwards, zpFlashPulse 0.6s ease-out forwards';

            iconContainer.style.textShadow = '0 0 5px rgba(255, 255, 255, 0.9)';
        };

        const deactivateStyle = () => {
            // Возврат в покой: желтая иконка, прозрачный фон, без анимации
            iconContainer.style.color = '#f1c40f';
            iconContainer.style.backgroundColor = 'transparent';
            iconContainer.style.opacity = '0.8';
            iconContainer.style.animation = 'none';
            iconContainer.style.boxShadow = 'none';
            iconContainer.style.textShadow = 'none';
            iconContainer.style.transform = 'rotate(0deg) translateX(0)';
        };

        iconContainer.addEventListener('mouseenter', activateStyle);
        iconContainer.addEventListener('mouseleave', deactivateStyle);

        // Логика клика
        iconContainer.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Эффект нажатия
            iconContainer.style.transform = 'scale(0.8)';
            iconContainer.style.animation = 'none';

            setTimeout(() => {
                activateStyle(); // Мгновенная вспышка
                setTimeout(deactivateStyle, 300);
            }, 100);

            log('Клик по мини-кнопке. Активация автоматизации...');
            isAutomationActive = true;

            isModalFilled = false;
            isCertSelected = false;
            isPoaSelected = false;
            isFinalSubmitDone = false;
            activeObservers.clear();

            originalBtn.click();

            setTimeout(waitForDialogAndStart, 200);

        });

        const parentDiv = originalBtn.parentElement;
        if (parentDiv) {
            if (parentDiv.style.display !== 'flex') {
                parentDiv.style.display = 'flex';
                parentDiv.style.alignItems = 'center';
            }
            parentDiv.appendChild(iconContainer);
        }

        // Определение режима работы
        const mode =
            location.pathname.includes('/add') || location.pathname.includes('/order-now')
                ? 'ADD (Опубликовать)'
                : location.pathname.includes('/edit')
                ? 'EDIT (Сохранить)'
                : location.pathname.includes('/protocol/add-final') || location.pathname.includes('/protocol_es/add-final')
                ? 'FINAL (Опубликовать)'
                : 'UNKNOWN';
        console.log(`[ZMO-AUTO] Мини-кнопка добавлена (режим: ${mode}).`);
    }

    // --- 2. ЗАПОЛНЕНИЕ ОБОСНОВАНИЯ (ОПЦИОНАЛЬНО) ---
    function fillModificationReason(dialogPane) {
        if (!isAutomationActive || isModalFilled) return;

        // Ищем textarea по имени
        const textarea = dialogPane.querySelector('textarea[name="modificationDescription"]');

        // Если поля нет в DOM, просто помечаем шаг как выполненный и идем дальше
        if (!textarea) {
            log('Поле "Обоснование" не найдено. Пропускаем шаг.');
            isModalFilled = true;
            currentStep = null; // Сбрасываем текущий шаг
            resetTimeout(); // Сбрасываем таймер
            return;
        }

        // Если поле есть, но оно уже заполнено (пользователь успел сам), тоже пропускаем
        if (textarea.value && textarea.value.trim() !== "") {
            log('Поле "Обоснование" уже заполнено. Пропускаем.');
            isModalFilled = true;
            currentStep = null; // Сбрасываем текущий шаг
            resetTimeout(); // Сбрасываем таймер
            return;
        }

        // Заполняем только если поле пустое и доступное
        if (!textarea.disabled && !textarea.hasAttribute('readonly')) {
            textarea.value = REASON_TEXT;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            isModalFilled = true;
            log('Обоснование заполнено.');
        } else {
            log('Поле "Обоснование" заблокировано. Пропускаем.');
            isModalFilled = true;
        }

        // После установки isModalFilled = true:
        isModalFilled = true;
        log('Обоснование заполнено.');
        currentStep = null;
        resetTimeout();

        currentStep = null; // Сбрасываем текущий шаг
        resetTimeout(); // Сбрасываем таймер
    }

    // --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: МГНОВЕННАЯ ПРОВЕРКА ---
    function trySelectImmediately(type, searchTerm, selectFirstIfNotFound, onComplete) {
        const panels = document.querySelectorAll('.p-dropdown-panel:not(.p-component-disabled)');
        if (panels.length === 0) return false;

        const activePanel = panels[panels.length - 1];
        const items = activePanel.querySelectorAll('.p-dropdown-item');

        if (items.length === 0) return false;

        let targetItem = null;
        let foundText = "";

        for (let item of items) {
            const text = item.textContent || item.innerText;
            if (text && text.includes(searchTerm)) {
                targetItem = item;
                foundText = text;
                break;
            }
        }

        if (!targetItem && selectFirstIfNotFound && items.length > 0) {
            targetItem = items[0];
            foundText = targetItem.textContent;
        }

        if (targetItem) {
            setTimeout(() => {
                if (document.body.contains(targetItem)) {
                    targetItem.click();
                    log(`(Sync) Клик выполнен: "${foundText}"`);
                    if (onComplete) onComplete();
                }
            }, 100);
            return true;
        }
        return false;
    }

    // --- 3. ОБРАБОТКА СЕРТИФИКАТОВ (ИСПРАВЛЕННАЯ ПРОВЕРКА) ---
    function handleCertificates(dialogPane) {
        if (!isAutomationActive || isCertSelected) return;
        if (activeObservers.has('cert')) return;

        const dropdownWidget = dialogPane.querySelector('ef-widget-dropdown[element_path*="certificate.content.certificate"]');
        if (!dropdownWidget) {
            log('Виджет сертификата не найден. Пропускаем.');
            isCertSelected = true;
            currentStep = null; // Сбрасываем текущий шаг
            resetTimeout(); // Сбрасываем таймер
            return;
        }

        const dropdownComponent = dropdownWidget.querySelector('p-dropdown');
        if (!dropdownComponent) return;

        // Проверка текста перед действием
        const labelEl = dropdownComponent.querySelector('.p-dropdown-label');
        let labelText = labelEl ? labelEl.textContent.trim() : '';

        const isEmpty = !labelText || labelText.includes('Выберите') || labelText === '&nbsp;';

        if (!isEmpty) {
            log(`Сертификат уже выбран ("${labelText}"). Пропускаем шаг.`);
            isCertSelected = true;
            currentStep = null; // Сбрасываем текущий шаг
            resetTimeout(); // Сбрасываем таймер
            return;
        }

        log('Сертификат не выбран. Начинаем поиск...');
        const trigger = dropdownComponent.querySelector('.p-dropdown-trigger') || labelEl;
        const isOpen = dropdownComponent.classList.contains('p-dropdown-open') ||
                       (trigger && trigger.getAttribute('aria-expanded') === 'true');

        if (isOpen) {
            const found = trySelectImmediately('cert', CERT_SEARCH_TERM, false, () => {
                isCertSelected = true;
                currentStep = null; // Сбрасываем текущий шаг
                resetTimeout(); // Сбрасываем таймер
                log('Сертификат успешно выбран (Sync).');
            });

            if (!found) {
                startDropdownObserver('cert', CERT_SEARCH_TERM, false, () => {
                    isCertSelected = true;
                    currentStep = null; // Сбрасываем текущий шаг
                    resetTimeout(); // Сбрасываем таймер
                    log('Сертификат успешно выбран (Async).');
                });
            }
        } else {
            if (trigger) {
                trigger.click();
                setTimeout(() => {
                    if (isAutomationActive && !isCertSelected && !activeObservers.has('cert')) {
                        if (!trySelectImmediately('cert', CERT_SEARCH_TERM, false, () => {
                            isCertSelected = true;
                            currentStep = null; // Сбрасываем текущий шаг
                            resetTimeout(); // Сбрасываем таймер
                        })) {
                            startDropdownObserver('cert', CERT_SEARCH_TERM, false, () => {
                                isCertSelected = true;
                                currentStep = null; // Сбрасываем текущий шаг
                                resetTimeout(); // Сбрасываем таймер
                            });
                        }
                    }
                }, 200);
            }
        }
    }



    // --- 4. ОБРАБОТКА ДОВЕРЕННОСТИ (С ОЖИДАНИЕМ ЗАГРУЗКИ И РАЗБЛОКИРОВКИ) ---
function handlePowerOfAttorney(dialogPane) {
    if (!isAutomationActive || isPoaSelected) return;
    if (activeObservers.has('poa')) return;

    const isLoading = document.querySelector('.p-overlay-mask, .loading-mask, .mat-progress-spinner') ||
                      dialogPane.style.pointerEvents === 'none';
    if (isLoading) {
        log('Доверенность: Окно заблокировано загрузкой. Ждем...');
        return;
    }

    let widgetContainer = null;

    // 1. Поиск по лейблу "Доверенность"
    const labels = Array.from(dialogPane.querySelectorAll('.element-label-value'));
    const poaLabel = labels.find(l => l.textContent.includes('Доверенность'));

    if (poaLabel) {
        widgetContainer = poaLabel.closest('ef-widget-dropdown');
        log('СПОСОБ 1 УСПЕХ: Виджет найден по лейблу "Доверенность".');
    }

    // 2. Если не нашли, ищем первый пустой дропдаун (кроме сертификата)
    if (!widgetContainer) {
        const allDropdowns = Array.from(dialogPane.querySelectorAll('ef-widget-dropdown'));
        for (let dw of allDropdowns) {
            const path = dw.getAttribute('element_path');
            if (path && path.includes('certificate.content.certificate')) continue;

            const labelEl = dw.querySelector('.p-dropdown-label');
            const labelText = labelEl ? labelEl.textContent.trim() : '';

            const isEmpty = !labelText ||
                            labelText.includes('Выберите') ||
                            labelText.includes('Не выбрано') ||
                            labelText === '&nbsp;';

            if (isEmpty) {
                widgetContainer = dw;
                log(`СПОСОБ 2 УСПЕХ: Виджет найден как пустой дропдаун (текст: "${labelText}").`);
                break;
            }
        }
    }

    // Если виджет не найден — включаем наблюдение
    if (!widgetContainer) {
        log('Доверенность: Виджет не найден. Настраиваем MutationObserver...');

        const observer = new MutationObserver((mutations, obs) => {
            if (!isAutomationActive || isPoaSelected) {
                obs.disconnect();
                activeObservers.delete('poa');
                return;
            }

            // Повторный поиск виджета
            const labels = Array.from(dialogPane.querySelectorAll('.element-label-value'));
            const poaLabel = labels.find(l => l.textContent.includes('Доверенность'));

            if (poaLabel) {
                widgetContainer = poaLabel.closest('ef-widget-dropdown');
                log('MutationObserver: Виджет найден по лейблу "Доверенность".');
            } else {
                const allDropdowns = Array.from(dialogPane.querySelectorAll('ef-widget-dropdown'));
                for (let dw of allDropdowns) {
                    const path = dw.getAttribute('element_path');
                    if (path && path.includes('certificate.content.certificate')) continue;

                    const labelEl = dw.querySelector('.p-dropdown-label');
                    const labelText = labelEl ? labelEl.textContent.trim() : '';

                    const isEmpty = !labelText ||
                                    labelText.includes('Выберите') ||
                                    labelText.includes('Не выбрано') ||
                                    labelText === '&nbsp;';

                    if (isEmpty) {
                        widgetContainer = dw;
                        log(`MutationObserver: Виджет найден как пустой дропдаун (текст: "${labelText}").`);
                        break;
                    }
                }
            }

            if (widgetContainer) {
                obs.disconnect();
                activeObservers.delete('poa');
                // здесь один и единственный вызов
                waitForUnlockAndProcess(widgetContainer);
            }
        });

        observer.observe(dialogPane, { childList: true, subtree: true });
        activeObservers.add('poa');
        return;
    }

    // Если виджет уже есть — один вызов
    waitForUnlockAndProcess(widgetContainer);
}



    let unlockAttempts = 0;
    const maxUnlockAttempts = 20; // Максимум 10 секунд (500 мс * 20)

    // Вспомогательная функция для ожидания разблокировки и обработки доверенности
function waitForUnlockAndProcess(widgetContainer, attempt = 0) {
    if (!isAutomationActive || isPoaSelected) return;

    const maxAttempts = 20;
    attempt = attempt || 0;

    const dropdownComponent = widgetContainer.querySelector('p-dropdown');
    if (!dropdownComponent) {
        log('Доверенность: Внутри виджета не найден компонент p-dropdown.');
        isPoaSelected = true;
        return;
    }

    const trigger = dropdownComponent.querySelector('.p-dropdown-trigger') || dropdownComponent.querySelector('.p-dropdown-label');
    if (!trigger) {
        log('Доверенность: Триггер не найден.');
        isPoaSelected = true;
        return;
    }

    // Уже выбрана?
    const labelEl = dropdownComponent.querySelector('.p-dropdown-label');
    const labelText = labelEl ? labelEl.textContent.trim() : '';
    const isEmpty = !labelText || labelText.includes('Выберите') || labelText.includes('Не выбрано');

    if (!isEmpty) {
        log(`Доверенность уже выбрана ("${labelText}"). Пропускаем.`);
        isPoaSelected = true;
        return;
    }

    if (trigger.hasAttribute('disabled') || trigger.classList.contains('p-disabled')) {
        log('Доверенность: Поле заблокировано. Ждем разблокировки...');
        if (attempt < maxAttempts) {
            setTimeout(() => waitForUnlockAndProcess(widgetContainer, attempt + 1), 500);
        } else {
            log('Доверенность: Превышено количество попыток разблокировки.');
            isPoaSelected = true;
        }
        return;
    }

    // Проверяем, открыт ли список
    const isOpen = dropdownComponent.classList.contains('p-dropdown-open') ||
                   (trigger && trigger.getAttribute('aria-expanded') === 'true');

    if (isOpen) {
        const found = trySelectImmediately('poa', POA_SEARCH_TERM, true, () => {
            isPoaSelected = true;
            log('Доверенность успешно выбрана (Sync).');
        });

        if (!found) {
            startDropdownObserver('poa', POA_SEARCH_TERM, true, () => {
                isPoaSelected = true;
                log('Доверенность успешно выбрана (Async).');
            });
        }
    } else {
        trigger.click();
        setTimeout(() => {
            if (isAutomationActive && !isPoaSelected && !activeObservers.has('poa')) {
                if (!trySelectImmediately('poa', POA_SEARCH_TERM, true, () => {
                    isPoaSelected = true;
                    log('Доверенность успешно выбрана (Post-Click Sync).');
                })) {
                    startDropdownObserver('poa', POA_SEARCH_TERM, true, () => {
                        isPoaSelected = true;
                        log('Доверенность успешно выбрана (Post-Click Async).');
                    });
                }
            }
        }, 300);
    }
}


    // --- 5. ФИНАЛЬНЫЙ КЛИК ---
    function performFinalSubmit(dialogPane) {
        if (!isAutomationActive || isFinalSubmitDone) return;
        if (!isPoaSelected) return;

        const isLoading = document.querySelector('.p-overlay-mask, .loading-mask, .mat-progress-spinner');
        if (isLoading) return;

        const saveWidget = dialogPane.querySelector('ef-widget-button[element_path="certificate.actions.save"]');
        if (!saveWidget) return;

        const saveBtn = saveWidget.querySelector('button.p-button');
        if (!saveBtn) return;

        if (saveBtn.hasAttribute('disabled') || saveWidget.getAttribute('widget_disabled') === 'true') {
            return;
        }

        log('Кнопка "Подписать и опубликовать на ЭТП" найдена. Клик!');
        saveBtn.click();
        isFinalSubmitDone = true;
        log('Финальный клик выполнен. Процесс завершен.');
    }

    // --- НАБЛЮДАТЕЛЬ ДЛЯ СПИСКОВ ---
    function startDropdownObserver(type, searchTerm, selectFirstIfNotFound, onComplete) {
        if (activeObservers.has(type)) return;

        let attempts = 0;
        const maxAttempts = 60;
        let isCompleted = false;

        const observerCallback = (mutations, obs) => {
            if (!isAutomationActive || isCompleted) {
                obs.disconnect();
                activeObservers.delete(type);
                return;
            }

            const panels = document.querySelectorAll('.p-dropdown-panel:not(.p-component-disabled)');
            if (panels.length > 0) {
                const activePanel = panels[panels.length - 1];
                const items = activePanel.querySelectorAll('.p-dropdown-item');

                if (items.length > 0) {
                    let targetItem = null;
                    let foundText = "";

                    for (let item of items) {
                        const text = item.textContent || item.innerText;
                        if (text && text.includes(searchTerm)) {
                            targetItem = item;
                            foundText = text;
                            break;
                        }
                    }

                    if (!targetItem && selectFirstIfNotFound && items.length > 0) {
                        targetItem = items[0];
                        foundText = targetItem.textContent;
                    }

                    if (targetItem) {
                        isCompleted = true;
                        setTimeout(() => {
                            if (document.body.contains(targetItem)) {
                                targetItem.click();
                                log(`(Async) Клик выполнен: "${foundText}"`);
                            }
                            obs.disconnect();
                            activeObservers.delete(type);
                            if (onComplete) onComplete();
                        }, 100);
                    }
                }
            }

            attempts++;
            if (attempts > maxAttempts) {
                obs.disconnect();
                activeObservers.delete(type);
            }
        };

        const observer = new MutationObserver(observerCallback);
        observer.observe(document.body, { childList: true, subtree: true });
        activeObservers.add(type);
    }

    // --- ОСНОВНАЯ ЛОГИКА ---
function runAutomationLogic() {
    if (!isAutomationActive) return;

    const dialogPane = document.querySelector('.dialog-pane.cdk-overlay-pane');
    if (!dialogPane || !dialogPane.innerText.includes("Подписать и опубликовать на ЭТП")) {
        log('Диалоговое окно не найдено. Ждем...');
        // Не перезапускаем таймер на каждом вызове, только один раз при старте
        if (!timeoutId) startTimeout();
        return;
    }

    // Сбрасываем таймер только при реальном прогрессе, а не при каждом вызове
    resetTimeout();

    if (!isModalFilled) {
        fillModificationReason(dialogPane);
    } else if (!isCertSelected) {
        handleCertificates(dialogPane);
    } else if (!isPoaSelected) {
        handlePowerOfAttorney(dialogPane);
    } else if (!isFinalSubmitDone) {
        performFinalSubmit(dialogPane);
    }

    // После любого шага — планируем следующий вызов, если состояние могло измениться
    setTimeout(() => {
        if (isAutomationActive) {
            runAutomationLogic();
        }
    }, 200);
}

    // Не дергать runAutomationLogic() при мутациях — только при старте скрипта и после клика на кнопку ЭЦП+.
const mainObserver = new MutationObserver(() => {
    addEcpButton();
});
mainObserver.observe(document.body, { childList: true, subtree: true });

    // Запуск автоматизации только при открытии модального окна
function waitForDialogAndStart() {
    if (!isAutomationActive) return;

    const dialogPane = document.querySelector('.dialog-pane.cdk-overlay-pane');
    if (dialogPane && dialogPane.innerText.includes("Подписать и опубликовать на ЭТП")) {
        log('Диалог найден, запускаем автоматизацию...');
        runAutomationLogic();
    } else {
        setTimeout(waitForDialogAndStart, 200);
    }
}


    setTimeout(() => {
        addEcpButton();
    }, 1000);
})();