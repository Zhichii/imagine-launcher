from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, 
    QPushButton, QScrollArea, QFrame, QSlider, QCheckBox,
    QSpacerItem, QSizePolicy, QTabWidget, QGroupBox, QLineEdit,
    QFileDialog, QColorDialog, QMainWindow, QListView
)
from PySide6.QtCore import Qt, Signal, QSize, QTimer
from PySide6.QtGui import QIcon, QFont, QPixmap, QFontMetrics
import json
import os
import sys
import winreg
import psutil
import logging
import platform
import webbrowser
from pathlib import Path
# form clutui
# i18n 
from core.i18n import i18n
# Resources Manager
from core.utils.resource_manager import ResourceManager
from core.log.log_manager import log
from core.utils.notif import NotificationType
from core.pages_core.pages_effect import PagesEffect
from core.ui.white_combox import WhiteComboBox
from core.ui.switch_card import SwitchCard
from core.ui.button_white import WhiteButton
from core.ui.scroll_style import ScrollStyle
from core.animations.scroll_hide_show import ScrollBarAnimation
from core.font.font_pages_manager import FontPagesManager
from minecraft.imagine_settings.ram_manager import RAMManager
from core.ui.progress_bar import ProgressBar

class SettingsPage(QWidget):
    settings_changed = Signal(dict)  # 发出设置改变信号
    language_changed = Signal(str)   # 添加语言改变信号
    
    def __init__(self, parent=None, config_file=None):
        super().__init__(parent)
        self.resource_manager = ResourceManager()
        self.config_file = config_file or os.path.join(os.path.expanduser('~'), '.clutui', 'config.json')
        self.settings = self._load_settings()
        self.font_manager = FontPagesManager()
        
        # 创建RAM管理器
        self.ram_manager = RAMManager(self.config_file)
        
        # 设置当前语言
        current_language = self.settings.get('language', 'zh')
        i18n.set_language(current_language)
        
        # 初始化背景效果映射
        self.background_effects = {
            "effect_none": i18n.get_text("effect_none", "无效果"),
            "effect_mica": i18n.get_text("effect_mica", "云母效果"),
            "effect_gaussian": i18n.get_text("effect_gaussian", "高斯模糊"),
            "effect_blur": i18n.get_text("effect_blur", "模糊效果"),
            "effect_acrylic": i18n.get_text("effect_acrylic", "亚克力效果"),
            "effect_aero": i18n.get_text("effect_aero", "Aero玻璃效果")
        }
        
        # 初始化语言显示映射
        self.lang_display = {
            "zh": i18n.get_text("lang_zh"),
            "en": i18n.get_text("lang_en"),
            "zh_hk": i18n.get_text("lang_zh_hk"),
            "origin": i18n.get_text("lang_origin")
        }
        
        # 反向映射
        self.lang_map = {v: k for k, v in self.lang_display.items()}
        
        # 初始化组件引用
        self.tab_widget = None
        self.effect_combo = None
        self.language_combo = None
        self.log_level_combo = None
        self.reset_button = None
        self.save_button = None
        self.startup_switch = None
        self.auto_save_switch = None
        self.scroll_area = None
        self.scroll_animation = None
        self.save_path_edit = None
        self.font_size_slider = None
        self.font_size_value = None
        self.ram_slider = None
        self.ram_value = None
        self.ram_used_label = None
        self.ram_available_label = None
        
        # 初始化信号连接状态跟踪字典
        self._signal_connections = {}
        
        # 先创建UI
        self._init_ui()
        
        # 最后连接信号
        try:
            self._connect_signals()
        except Exception as e:
            log.error(f"连接组件信号失败: {str(e)}")
        
        # 创建定时器，定期更新内存信息
        self.memory_update_timer = QTimer(self)
        self.memory_update_timer.timeout.connect(self._update_memory_info)
        self.memory_update_timer.start(5000)  # 每5秒更新一次

    def closeEvent(self, event):
        try:
            # 停止内存更新定时器
            if hasattr(self, 'memory_update_timer') and self.memory_update_timer.isActive():
                self.memory_update_timer.stop()
                
            # 断开所有信号连接
            self._disconnect_all_signals()
        except Exception as e:
            log.error(f"关闭事件处理出错: {str(e)}")
        super().closeEvent(event)

    def _disconnect_all_signals(self):
        try:
            # 断开语言变更信号
            try:
                if hasattr(i18n, 'language_changed') and self._signal_connections.get('language_changed', False):
                    try:
                        i18n.language_changed.disconnect(self._update_all_texts)
                        self._signal_connections['language_changed'] = False
                    except (TypeError, RuntimeError, RuntimeWarning):
                        # 如果信号未连接或已断开，会抛出异常，忽略它
                        self._signal_connections['language_changed'] = False
                        pass
            except Exception:
                pass
            
            # 断开其他可能的信号连接
            if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                try:
                    if self._signal_connections.get('effect_combo_changed', False):
                        self.effect_combo.currentIndexChanged.disconnect(self.on_bg_effect_changed)
                        self._signal_connections['effect_combo_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['effect_combo_changed'] = False
                    pass
                    
            if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                try:
                    if self._signal_connections.get('language_combo_changed', False):
                        self.language_combo.currentIndexChanged.disconnect(self._on_language_selection_changed)
                        self._signal_connections['language_combo_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['language_combo_changed'] = False
                    pass
                    
            if hasattr(self, 'log_level_combo') and self._is_widget_valid(self.log_level_combo):
                try:
                    # 使用blockSignals来暂时阻止信号
                    self.log_level_combo.blockSignals(True)
                except (TypeError, RuntimeError, RuntimeWarning):
                    pass
                    
            if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider):
                try:
                    if self._signal_connections.get('ram_slider_changed', False):
                        self.ram_slider.valueChanged.disconnect(self._on_ram_slider_changed)
                        self._signal_connections['ram_slider_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['ram_slider_changed'] = False
                    pass
                    
            if hasattr(self, 'font_size_slider') and self._is_widget_valid(self.font_size_slider):
                try:
                    # 使用blockSignals来暂时阻止信号
                    self.font_size_slider.blockSignals(True)
                except (TypeError, RuntimeError, RuntimeWarning):
                    pass
                    
            # 断开保存按钮的信号连接
            if hasattr(self, 'save_button') and self._is_widget_valid(self.save_button):
                try:
                    if self._signal_connections.get('save_button_clicked', False):
                        self.save_button.clicked.disconnect(self._apply_settings)
                        self._signal_connections['save_button_clicked'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['save_button_clicked'] = False
                    pass
                    
            # 断开重置按钮的信号连接
            if hasattr(self, 'reset_button') and self._is_widget_valid(self.reset_button):
                try:
                    if self._signal_connections.get('reset_button_clicked', False):
                        self.reset_button.clicked.disconnect(self._reset_settings)
                        self._signal_connections['reset_button_clicked'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['reset_button_clicked'] = False
                    pass
                    
            # 断开开关的信号连接
            if hasattr(self, 'startup_switch') and self._is_widget_valid(self.startup_switch):
                try:
                    if self._signal_connections.get('startup_switch_changed', False):
                        self.startup_switch.switch.stateChanged.disconnect(self.on_startup_changed)
                        self._signal_connections['startup_switch_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['startup_switch_changed'] = False
                    pass
                    
            if hasattr(self, 'auto_save_switch') and self._is_widget_valid(self.auto_save_switch):
                try:
                    if self._signal_connections.get('auto_save_switch_changed', False):
                        self.auto_save_switch.switch.stateChanged.connect(self.on_auto_save_changed)
                        self._signal_connections['auto_save_switch_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['auto_save_switch_changed'] = False
                    pass
                    
            # 断开自动RAM设置开关的信号连接
            if hasattr(self, 'auto_ram_switch') and self._is_widget_valid(self.auto_ram_switch):
                try:
                    if self._signal_connections.get('auto_ram_switch_changed', False):
                        self.auto_ram_switch.switch.stateChanged.disconnect(self.on_auto_ram_changed)
                        self._signal_connections['auto_ram_switch_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['auto_ram_switch_changed'] = False
                    pass
                    
            # 断开RAM管理器的信号连接
            if hasattr(self, 'ram_manager'):
                try:
                    if self._signal_connections.get('ram_manager_changed', False):
                        self.ram_manager.ram_changed.disconnect(self._on_ram_value_changed)
                        self._signal_connections['ram_manager_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['ram_manager_changed'] = False
                    pass
                    
                try:
                    if self._signal_connections.get('auto_ram_state_changed', False):
                        self.ram_manager.auto_ram_changed.disconnect(self._on_auto_ram_state_changed)
                        self._signal_connections['auto_ram_state_changed'] = False
                except (TypeError, RuntimeError, RuntimeWarning):
                    self._signal_connections['auto_ram_state_changed'] = False
                    pass
                    
        except Exception as e:
            log.error(f"断开信号连接时出错: {str(e)}")

    def __del__(self):
        """析构函数，确保在对象销毁时断开所有信号连接"""
        try:
            # 尝试断开所有信号连接
            if hasattr(self, '_disconnect_all_signals'):
                self._disconnect_all_signals()
        except Exception:
            # 在析构函数中不应该抛出异常
            pass

    def _load_config(self):
        """加载配置文件"""
        config = {}
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
        except Exception as e:
            log.error(f"{i18n.get_text('load_config_error')}: {str(e)}")
        return config

    def _save_config(self, config):
        """保存配置文件"""
        try:
            # 确保配置文件目录存在
            config_dir = os.path.dirname(self.config_file)
            if not os.path.exists(config_dir):
                os.makedirs(config_dir, exist_ok=True)
                
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=4, ensure_ascii=False)
            return True
        except Exception as e:
            log.error(f"{i18n.get_text('save_config_error')}: {str(e)}")
            return False

    def _load_settings(self):
        """加载设置"""
        default_settings = {
            'language': 'zh',
            'theme': 'light',
            'background_effect': 'effect_blur',
            'font_size': 12,
            'auto_update': True,
            'auto_start': False,
            'log_level': 'info',
            'api_key': '',
            'auto_save': False,
            'save_path': os.path.expanduser('~/Documents/ClutUI'),
            'launcher_ram': 4096  # 默认分配4GB RAM
        }
        
        config = self._load_config()
        return {**default_settings, **config}

    def _save_settings(self):
        """保存设置"""
        success = self._save_config(self.settings)
        if success:
            log.info(i18n.get_text("settings_saved"))
            self.settings_changed.emit(self.settings)
            
            # 显示保存成功通知
            if hasattr(self.window(), 'show_notification'):
                self.window().show_notification(
                    text=i18n.get_text("settings_saved"),
                    type=NotificationType.SUCCESS,
                    duration=2000
                )
        else:
            # 显示保存失败通知
            if hasattr(self.window(), 'show_notification'):
                self.window().show_notification(
                    text=i18n.get_text("settings_save_error"),
                    type=NotificationType.ERROR,
                    duration=3000
                )
        return success
    
    def _init_ui(self):
        # 创建主布局
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(0)
        
        # 创建一个容器来包裹滚动区域
        scroll_container = QWidget()
        scroll_container.setObjectName("scrollContainer")
        scroll_container_layout = QVBoxLayout(scroll_container)
        scroll_container_layout.setContentsMargins(0, 0, 0, 0)
        
        # 设置滚动区域
        scroll_area = QScrollArea()
        self.scroll_area = scroll_area
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll_area.setObjectName("scrollArea")
        
        # 应用滚动条样式
        ScrollStyle.apply_to_widget(scroll_area)
        
        # 设置滚动条动画
        self.scroll_animation = ScrollBarAnimation(scroll_area.verticalScrollBar())
        
        # 连接滚动条值改变信号
        scroll_area.verticalScrollBar().valueChanged.connect(
            self.scroll_animation.show_temporarily
        )
        
        # 内容容器
        container = QWidget()
        container.setObjectName("container")
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(40, 40, 40, 40)
        container_layout.setSpacing(30)
        
        # 标题
        title_label = QLabel(i18n.get_text("settings"))
        title_label.setObjectName("title_label")
        self.font_manager.apply_title_style(title_label)
        container_layout.addWidget(title_label)
        
        # 分隔线
        separator = QFrame()
        separator.setFrameShape(QFrame.HLine)
        separator.setFrameShadow(QFrame.Sunken)
        container_layout.addWidget(separator)
        
        # 设置选项卡
        self.tab_widget = QTabWidget()
        self.tab_widget.setDocumentMode(True)
        
        # 创建各个设置选项卡
        general_tab = self._create_general_tab()
        appearance_tab = self._create_appearance_tab()
        advanced_tab = self._create_advanced_tab()
        
        # 添加选项卡到tab_widget
        self.tab_widget.addTab(general_tab, i18n.get_text("general"))
        self.tab_widget.addTab(appearance_tab, i18n.get_text("appearance"))
        self.tab_widget.addTab(advanced_tab, i18n.get_text("advanced"))
        
        container_layout.addWidget(self.tab_widget)
        
        # 底部按钮区域
        button_layout = QHBoxLayout()
        button_layout.setSpacing(10)
        
        # 添加弹性空间
        button_layout.addStretch()
        
        # 重置按钮
        self.reset_button = WhiteButton(i18n.get_text("reset"), "refresh")
        button_layout.addWidget(self.reset_button)
        
        # 保存按钮
        self.save_button = WhiteButton(i18n.get_text("save"), "save")
        button_layout.addWidget(self.save_button)
        
        container_layout.addLayout(button_layout)
        
        # 设置滚动区域的内容
        scroll_area.setWidget(container)
        scroll_container_layout.addWidget(scroll_area)
        
        # 将滚动容器添加到主布局
        self.layout.addWidget(scroll_container)
        
        # 设置全局样式
        self.setStyleSheet("""
            QWidget {
                background: transparent;
            }
            
            QWidget#scrollContainer {
                background: transparent;
                margin: 0px 20px;
            }
            
            QScrollArea#scrollArea, QScrollArea#scrollArea > QWidget#qt_scrollarea_viewport {
                background: transparent;
                border: none;
                border-radius: 16px;
            }
            
            QWidget#container {
                background: transparent;
                border-radius: 16px;
            }
            
            QTabWidget::pane {
                border: 1px solid rgba(229, 231, 235, 0.5);
                border-radius: 16px;
                background: transparent;
                margin-top: -1px;
                padding: 10px;
            }
            
            QTabBar::tab {
                padding: 10px 24px;
                margin-right: 4px;
                border: 1px solid rgba(229, 231, 235, 0.5);
                border-bottom: none;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
                background: transparent;
                color: #6B7280;
            }
            
            QTabBar::tab:selected {
                background: transparent;
                color: #2196F3;
                border-bottom: none;
            }
            
            QTabBar::tab:hover:!selected {
                background: rgba(243, 244, 246, 0.1);
                color: #4B5563;
            }
            
            QLabel {
                color: #374151;
                background: transparent;
            }
            
            QScrollBar:vertical {
                background: transparent;
                width: 8px;
                margin: 4px 2px;
            }
            
            QScrollBar::handle:vertical {
                background: rgba(209, 213, 219, 0.8);
                border-radius: 4px;
                min-height: 30px;
            }
            
            QScrollBar::handle:vertical:hover {
                background: rgba(156, 163, 175, 0.8);
            }
            
            QScrollBar::add-line:vertical,
            QScrollBar::sub-line:vertical {
                height: 0px;
            }
            
            QScrollBar::add-page:vertical,
            QScrollBar::sub-page:vertical {
                background: transparent;
            }
        """)
    
    def _create_general_tab(self):
        """创建常规设置选项卡"""
        general_tab = QWidget()
        layout = QVBoxLayout(general_tab)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(24)
        
        # 语言设置
        language_group = self._create_group_box(i18n.get_text("language_settings"))
        language_group.setObjectName("language_group")
        language_layout = QVBoxLayout()
        language_layout.setContentsMargins(15, 15, 15, 15)
        language_layout.setSpacing(15)
        
        # 添加语言设置描述
        language_desc = QLabel(i18n.get_text("language_settings_desc"))
        language_desc.setObjectName("language_desc")
        self.font_manager.apply_normal_style(language_desc)
        language_desc.setWordWrap(True)
        language_layout.addWidget(language_desc)
        
        language_select_layout = QHBoxLayout()
        language_label = QLabel(i18n.get_text("language"))
        language_label.setObjectName("language_label")
        self.font_manager.apply_normal_style(language_label)
        self.font_manager.apply_normal_style(self.tab_widget)
        self.language_combo = WhiteComboBox()
        self.language_combo.setFixedWidth(200)
        
        # 添加语言选项
        for lang_code, display_name in self.lang_display.items():
            self.language_combo.addItem(display_name, lang_code)
        
        # 设置当前选择的语言
        current_language = self.settings.get('language', 'zh')
        for i in range(self.language_combo.count()):
            if self.language_combo.itemData(i) == current_language:
                self.language_combo.setCurrentIndex(i)
                break
                
        language_select_layout.addWidget(language_label)
        language_select_layout.addWidget(self.language_combo)
        language_select_layout.addStretch()
        
        language_layout.addLayout(language_select_layout)
        language_group.setLayout(language_layout)
        
        # 启动设置
        startup_group = self._create_group_box(i18n.get_text("auto_start"))
        startup_group.setObjectName("startup_group")
        startup_layout = QVBoxLayout()
        startup_layout.setContentsMargins(15, 15, 15, 15)
        startup_layout.setSpacing(15)
        
        # 开机自启动开关
        self.startup_switch = SwitchCard(
            title=i18n.get_text("auto_start"),
            description=i18n.get_text("auto_start_desc"),
            switch_text=i18n.get_text("auto_start")
        )
        self.startup_switch.set_checked(self.settings.get('auto_start', False))
        
        self.auto_save_switch = SwitchCard(
            title=i18n.get_text("auto_save"),
            description=i18n.get_text("auto_save_desc"),
            switch_text=i18n.get_text("auto_save")
        )
        self.auto_save_switch.set_checked(self.settings.get('auto_save', False))
        
        startup_layout.addWidget(self.startup_switch)
        startup_layout.addWidget(self.auto_save_switch)
        startup_group.setLayout(startup_layout)
        
        # 保存路径设置
        save_path_layout = QHBoxLayout()
        save_path_label = QLabel(i18n.get_text("save_path"))
        save_path_label.setObjectName("save_path_label")
        self.font_manager.apply_normal_style(save_path_label)
        self.save_path_edit = QLineEdit(self.settings.get('save_path', ''))
        self.save_path_edit.setReadOnly(True)
        browse_button = WhiteButton(i18n.get_text("browse"), "folder")
        browse_button.setObjectName("browse_button")
        browse_button.clicked.connect(self._browse_save_path)
        
        save_path_layout.addWidget(save_path_label)
        save_path_layout.addWidget(self.save_path_edit)
        save_path_layout.addWidget(browse_button)
        
        save_path_layout.addStretch()
        save_path_group = QGroupBox(i18n.get_text("save_path"))
        save_path_group.setObjectName("save_path_group")
        save_path_group.setLayout(save_path_layout)
        
        # 添加各组到布局
        layout.addWidget(language_group)
        layout.addWidget(startup_group)
        layout.addWidget(save_path_group)
        layout.addStretch()
        
        return general_tab
    
    def _create_appearance_tab(self):
        """创建外观设置选项卡"""
        appearance_tab = QWidget()
        layout = QVBoxLayout(appearance_tab)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(24)
        
        # 背景效果设置
        effect_group = self._create_group_box(i18n.get_text("effect_settings"))
        effect_group.setObjectName("effect_group")
        effect_layout = QVBoxLayout()
        effect_layout.setContentsMargins(15, 15, 15, 15)
        effect_layout.setSpacing(15)
        
        # 添加描述标签
        effect_desc = QLabel(i18n.get_text("effect_settings_desc"))
        effect_desc.setObjectName("effect_desc")
        self.font_manager.apply_normal_style(effect_desc)
        effect_desc.setWordWrap(True)
        effect_layout.addWidget(effect_desc)
        
        effect_select_layout = QHBoxLayout()
        effect_label = QLabel(i18n.get_text("effect_type"))
        effect_label.setObjectName("effect_label")
        self.font_manager.apply_normal_style(effect_label)
        self.effect_combo = WhiteComboBox()
        self.effect_combo.setFixedWidth(200)
        
        # 添加效果选项
        for effect_code, display_name in self.background_effects.items():
            self.effect_combo.addItem(display_name, effect_code)
        
        # 设置当前选择的效果
        current_effect = self.settings.get('background_effect', 'effect_blur')
        for i in range(self.effect_combo.count()):
            if self.effect_combo.itemData(i) == current_effect:
                self.effect_combo.setCurrentIndex(i)
                break
                
        effect_select_layout.addWidget(effect_label)
        effect_select_layout.addWidget(self.effect_combo)
        effect_select_layout.addStretch()
        
        effect_layout.addLayout(effect_select_layout)
        effect_group.setLayout(effect_layout)
        
        # 字体设置
        font_group = self._create_group_box(i18n.get_text("font_settings"))
        font_group.setObjectName("font_group")
        font_layout = QVBoxLayout()
        font_layout.setContentsMargins(20, 20, 20, 20)
        font_layout.setSpacing(20)
        
        # 添加字体设置描述
        font_desc = QLabel(i18n.get_text("font_settings_desc"))
        font_desc.setObjectName("font_desc")
        self.font_manager.apply_normal_style(font_desc)
        font_desc.setWordWrap(True)
        font_layout.addWidget(font_desc)
        
        font_size_layout = QHBoxLayout()
        font_size_label = QLabel(i18n.get_text("font_size"))
        font_size_label.setObjectName("font_size_label")
        self.font_manager.apply_normal_style(font_size_label)
        self.font_size_slider = QSlider(Qt.Horizontal)
        self.font_size_slider.setMinimum(10)
        self.font_size_slider.setMaximum(18)
        self.font_size_slider.setValue(self.settings.get('font_size', 12))
        self.font_size_value = QLabel(str(self.font_size_slider.value()))
        self.font_manager.apply_normal_style(self.font_size_value)
        
        # 连接字体大小滑块的值变化信号
        self.font_size_slider.valueChanged.connect(
            lambda v: self.font_size_value.setText(str(v))
        )
        
        font_size_layout.addWidget(font_size_label)
        font_size_layout.addWidget(self.font_size_slider)
        font_size_layout.addWidget(self.font_size_value)
        
        font_layout.addLayout(font_size_layout)
        font_group.setLayout(font_layout)
        
        # 添加各组到布局
        layout.addWidget(effect_group)
        layout.addWidget(font_group)
        layout.addStretch()
        
        # 将外观设置页面添加到tab_widget
        return appearance_tab
    

    def _create_advanced_tab(self):
        advanced_tab = QWidget()
        advanced_layout = QVBoxLayout(advanced_tab)
        advanced_layout.setContentsMargins(20, 20, 20, 20)
        advanced_layout.setSpacing(20)
        
        # RAM设置组
        ram_group = QGroupBox(i18n.get_text("ram_settings", "内存设置"))
        ram_group.setObjectName("ram_group")
        ram_layout = QVBoxLayout(ram_group)
        ram_layout.setContentsMargins(15, 20, 15, 15)
        ram_layout.setSpacing(10)
        self.font_manager.apply_normal_style(ram_group)
        
        # RAM设置描述
        ram_desc = QLabel(i18n.get_text("ram_settings_desc"))
        ram_desc.setObjectName("ram_desc")
        self.font_manager.apply_normal_style(ram_desc)
        ram_desc.setWordWrap(True)
        ram_layout.addWidget(ram_desc)
        
        # 添加自动RAM设置开关
        self.auto_ram_switch = SwitchCard(
            title=i18n.get_text("auto_ram"),
            description=i18n.get_text("auto_ram_desc"),
            switch_text=i18n.get_text("auto_ram")
        )
        self.auto_ram_switch.set_checked(self.ram_manager.get_auto_ram())
        ram_layout.addWidget(self.auto_ram_switch)
        
        # RAM大小滑块
        ram_slider_layout = QHBoxLayout()
        ram_label = QLabel(i18n.get_text("ram_size"))
        ram_label.setObjectName("ram_label")
        self.font_manager.apply_normal_style(ram_label)
        
        # 使用RAM管理器获取系统内存信息
        max_ram = self.ram_manager.get_max_allowed_ram()
        
        self.ram_slider = QSlider(Qt.Horizontal)
        self.ram_slider.setMinimum(self.ram_manager.get_min_allowed_ram())
        self.ram_slider.setMaximum(max_ram)
        self.ram_slider.setSingleStep(128)
        self.ram_slider.setPageStep(512)
        
        # 获取当前设置的RAM
        current_ram = self.ram_manager.get_ram_size()
        self.ram_slider.setValue(current_ram)
        
        # 如果自动RAM设置已启用，禁用滑块
        if self.ram_manager.get_auto_ram():
            self.ram_slider.setEnabled(False)
        
        self.ram_value = QLabel(f"{self.ram_slider.value()} MB")
        self.font_manager.apply_normal_style(self.ram_value)
        
        # 添加系统总内存显示
        system_ram_label = QLabel(f"({i18n.get_text('system_total_ram')}: {self.ram_manager.get_system_memory()} MB)")
        self.font_manager.apply_normal_style(system_ram_label)
        system_ram_label.setObjectName("system_ram_label")
        
        # 添加已使用内存和可用内存显示
        ram_info_layout = QVBoxLayout()
        
        # 已使用内存部分
        ram_used_layout = QVBoxLayout()
        self.ram_used_label = QLabel(f"{i18n.get_text('ram_used')}: {self.ram_manager.get_used_ram()} MB")
        self.font_manager.apply_normal_style(self.ram_used_label)
        self.ram_used_label.setObjectName("ram_used_label")
        
        # 添加已使用内存进度条
        self.ram_used_progress = ProgressBar(self)
        try:
            used_ram = self.ram_manager.get_used_ram()
            total_ram = self.ram_manager.get_system_memory()
            used_percent = min(100, int(used_ram / total_ram * 100)) if total_ram > 0 else 0
            self.ram_used_progress.setProgress(used_percent)
        except Exception as e:
            log.error(f"计算已使用内存百分比失败: {str(e)}")
            self.ram_used_progress.setProgress(0)
        
        ram_used_layout.addWidget(self.ram_used_label)
        ram_used_layout.addWidget(self.ram_used_progress)
        ram_used_layout.setSpacing(4)
        
        # 可用内存部分
        ram_available_layout = QVBoxLayout()
        self.ram_available_label = QLabel(f"{i18n.get_text('ram_available')}: {self.ram_manager.get_available_ram()} MB")
        self.font_manager.apply_normal_style(self.ram_available_label)
        self.ram_available_label.setObjectName("ram_available_label")
        
        # 添加可用内存进度条
        self.ram_available_progress = ProgressBar(self)
        try:
            available_ram = self.ram_manager.get_available_ram()
            total_ram = self.ram_manager.get_system_memory()
            available_percent = min(100, int(available_ram / total_ram * 100)) if total_ram > 0 else 0
            self.ram_available_progress.setProgress(available_percent)
        except Exception as e:
            log.error(f"计算可用内存百分比失败: {str(e)}")
            self.ram_available_progress.setProgress(0)
        
        ram_available_layout.addWidget(self.ram_available_label)
        ram_available_layout.addWidget(self.ram_available_progress)
        ram_available_layout.setSpacing(4)
        
        # 将两个布局添加到主布局
        ram_info_layout.addLayout(ram_used_layout)
        ram_info_layout.addLayout(ram_available_layout)
        ram_info_layout.setSpacing(10)
        
        ram_slider_layout.addWidget(ram_label)
        ram_slider_layout.addWidget(self.ram_slider)
        ram_slider_layout.addWidget(self.ram_value)
        ram_layout.addLayout(ram_slider_layout)
        ram_layout.addWidget(system_ram_label)
        ram_layout.addLayout(ram_info_layout)
        
        # 日志设置组
        log_group = QGroupBox(i18n.get_text("log_settings"))
        log_group.setObjectName("log_group")
        log_layout = QVBoxLayout(log_group)
        log_layout.setContentsMargins(15, 20, 15, 15)
        log_layout.setSpacing(10)
        self.font_manager.apply_normal_style(log_group)
        
        # 日志级别选择
        log_level_layout = QHBoxLayout()
        self.log_level_label = QLabel(i18n.get_text("log_level"))
        self.log_level_label.setObjectName("log_level_label")
        self.log_level_combo = WhiteComboBox()
        self.font_manager.apply_normal_style(self.log_level_label)
        # 添加日志级别选项
        log_levels = [
            ("debug", i18n.get_text("log_level_debug")),
            ("info", i18n.get_text("log_level_info")),
            ("warning", i18n.get_text("log_level_warning")),
            ("error", i18n.get_text("log_level_error")),
            ("critical", i18n.get_text("log_level_critical"))
        ]
        
        for level_code, display_name in log_levels:
            self.log_level_combo.addItem(display_name, level_code)
            
        # 设置当前选中的日志级别
        current_level = self.settings.get('log_level', 'info')
        for i in range(self.log_level_combo.count()):
            if self.log_level_combo.itemData(i) == current_level:
                self.log_level_combo.setCurrentIndex(i)
                break
                
        log_level_layout.addWidget(self.log_level_label)
        log_level_layout.addWidget(self.log_level_combo)
        log_level_layout.addStretch()
        
        
        log_layout.addLayout(log_level_layout)
        
        # 查看日志按钮
        view_logs_button = WhiteButton(i18n.get_text("view_logs"), "article")
        view_logs_button.setObjectName("view_logs_button")
        view_logs_button.clicked.connect(self._view_logs)
        log_layout.addWidget(view_logs_button)
        
        # 添加组到布局
        advanced_layout.addWidget(ram_group)
        advanced_layout.addWidget(log_group)
        advanced_layout.addStretch()
        
        return advanced_tab
    
    def _create_group_box(self, title):
        group = QGroupBox(title)
        self.font_manager.apply_normal_style(group)
        group.setStyleSheet("""
            QGroupBox {
                border: 1px solid rgba(229, 231, 235, 0.5);
                border-radius: 16px;
                margin-top: 26px;
                padding: 32px 20px 20px 20px;
                background: transparent;
            }
            
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 20px;
                padding: 0 10px;
                color: #374151;
                background: transparent;
            }
            
            QLabel {
                color: #374151;
                background: transparent;
            }
            
            QLineEdit {
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(229, 231, 235, 0.5);
                border-radius: 8px;
                padding: 8px 12px;
                color: #1F2937;
            }
            
            QLineEdit:hover {
                border-color: #2196F3;
                background: rgba(255, 255, 255, 0.15);
            }
            
            QLineEdit:focus {
                border-color: #2196F3;
                background: rgba(255, 255, 255, 0.2);
                outline: none;
            }
            
            QSlider::groove:horizontal {
                height: 6px;
                background: #E5E7EB;
                border-radius: 3px;
                margin: 0 5px;
            }
            
            QSlider::handle:horizontal {
                width: 20px;
                height: 20px;
                margin: -7px -5px;
                border-radius: 10px;
                background: #2196F3;
                border: 2px solid white;
            }
            
            QSlider::handle:horizontal:hover {
                background: #1E88E5;
            }
            
            QSlider::sub-page:horizontal {
                background: #2196F3;
                border-radius: 3px;
            }
        """)
        return group
    
    def _connect_signals(self):
        """连接信号槽"""
        try:
            # 先断开所有可能的信号连接，避免重复连接
            self._disconnect_all_signals()
            
            # 确保所有组件的信号都未被阻塞
            if hasattr(self, 'log_level_combo') and self._is_widget_valid(self.log_level_combo):
                self.log_level_combo.blockSignals(False)
                
            if hasattr(self, 'font_size_slider') and self._is_widget_valid(self.font_size_slider):
                self.font_size_slider.blockSignals(False)
            
            # 连接各个组件的信号
            if hasattr(self, 'save_button') and self._is_widget_valid(self.save_button):
                self.save_button.clicked.connect(self._apply_settings)
                self._signal_connections['save_button_clicked'] = True
                
            if hasattr(self, 'reset_button') and self._is_widget_valid(self.reset_button):
                self.reset_button.clicked.connect(self._reset_settings)
                self._signal_connections['reset_button_clicked'] = True
                
            if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                self.language_combo.currentIndexChanged.connect(self._on_language_selection_changed)
                self._signal_connections['language_combo_changed'] = True
                
            if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                self.effect_combo.currentIndexChanged.connect(self.on_bg_effect_changed)
                self._signal_connections['effect_combo_changed'] = True
                
            if hasattr(self, 'startup_switch') and self._is_widget_valid(self.startup_switch):
                self.startup_switch.switch.stateChanged.connect(self.on_startup_changed)
                self._signal_connections['startup_switch_changed'] = True
                
            if hasattr(self, 'auto_save_switch') and self._is_widget_valid(self.auto_save_switch):
                self.auto_save_switch.switch.stateChanged.connect(self.on_auto_save_changed)
                self._signal_connections['auto_save_switch_changed'] = True
                
            # 连接自动RAM设置开关信号
            if hasattr(self, 'auto_ram_switch') and self._is_widget_valid(self.auto_ram_switch):
                self.auto_ram_switch.switch.stateChanged.connect(self.on_auto_ram_changed)
                self._signal_connections['auto_ram_switch_changed'] = True
                
            # 连接RAM滑块信号
            if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider):
                self.ram_slider.valueChanged.connect(self._on_ram_slider_changed)
                self._signal_connections['ram_slider_changed'] = True
                
            # 连接字体大小滑块信号
            if hasattr(self, 'font_size_slider') and self._is_widget_valid(self.font_size_slider):
                self.font_size_slider.valueChanged.connect(
                    lambda v: self.font_size_value.setText(str(v)) if hasattr(self, 'font_size_value') and self._is_widget_valid(self.font_size_value) else None
                )
                self._signal_connections['font_size_slider_changed'] = True
                
            # 连接语言变更信号
            try:
                if hasattr(i18n, 'language_changed'):
                    i18n.language_changed.connect(self._update_all_texts)
                    self._signal_connections['language_changed'] = True
            except Exception as e:
                log.error(f"连接语言变更信号失败: {str(e)}")
                
            # 连接RAM管理器的信号
            if hasattr(self, 'ram_manager'):
                # 当RAM值改变时更新UI
                self.ram_manager.ram_changed.connect(self._on_ram_value_changed)
                self._signal_connections['ram_manager_changed'] = True
                
                # 当自动RAM设置状态改变时更新UI
                self.ram_manager.auto_ram_changed.connect(self._on_auto_ram_state_changed)
                self._signal_connections['auto_ram_state_changed'] = True
                
        except Exception as e:
            log.error(f"连接信号时出错: {str(e)}")
    
    def _apply_settings(self):
        """应用设置"""
        try:
            # 更新设置字典
            if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                self.settings['language'] = self.language_combo.currentData()
                
            if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                self.settings['background_effect'] = self.effect_combo.currentData()
                
            if hasattr(self, 'font_size_slider') and self._is_widget_valid(self.font_size_slider):
                self.settings['font_size'] = self.font_size_slider.value()
                
            if hasattr(self, 'startup_switch') and self._is_widget_valid(self.startup_switch):
                self.settings['auto_start'] = self.startup_switch.is_checked()
                
            if hasattr(self, 'auto_save_switch') and self._is_widget_valid(self.auto_save_switch):
                self.settings['auto_save'] = self.auto_save_switch.is_checked()
                
            if hasattr(self, 'log_level_combo') and self._is_widget_valid(self.log_level_combo):
                self.settings['log_level'] = self.log_level_combo.currentData()
                
            if hasattr(self, 'save_path_edit') and self._is_widget_valid(self.save_path_edit):
                self.settings['save_path'] = self.save_path_edit.text()
            
            # 使用RAM管理器设置RAM大小
            if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider) and hasattr(self, 'ram_manager'):
                # 只有在非自动RAM模式下才设置RAM大小
                if not self.ram_manager.get_auto_ram():
                    self.ram_manager.set_ram_size(self.ram_slider.value())
            
            # 保存设置
            self._save_settings()
        except Exception as e:
            log.error(f"应用设置时出错: {str(e)}")
    
    def _reset_settings(self):
        """重置设置为默认值"""
        try:
            # 语言
            if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                for i in range(self.language_combo.count()):
                    if self.language_combo.itemData(i) == 'zh':
                        self.language_combo.setCurrentIndex(i)
                        break
                    
            # 背景效果
            if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                for i in range(self.effect_combo.count()):
                    if self.effect_combo.itemData(i) == 'blur':
                        self.effect_combo.setCurrentIndex(i)
                        break
                    
            # 字体大小
            if hasattr(self, 'font_size_slider') and self._is_widget_valid(self.font_size_slider):
                self.font_size_slider.setValue(12)
            
            # 自动RAM设置 - 默认禁用
            if hasattr(self, 'auto_ram_switch') and self._is_widget_valid(self.auto_ram_switch):
                self.auto_ram_switch.set_checked(False)
                
            # RAM大小 - 使用RAM管理器获取推荐值
            if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider) and hasattr(self, 'ram_manager'):
                recommended_ram = self.ram_manager.get_recommended_ram()
                self.ram_slider.setValue(recommended_ram)
                # 启用RAM滑块（因为自动RAM设置已禁用）
                self.ram_slider.setEnabled(True)
            
            # 启动设置
            if hasattr(self, 'startup_switch') and self._is_widget_valid(self.startup_switch):
                self.startup_switch.set_checked(False)
                
            if hasattr(self, 'auto_save_switch') and self._is_widget_valid(self.auto_save_switch):
                self.auto_save_switch.set_checked(False)
            
            # 日志级别
            if hasattr(self, 'log_level_combo') and self._is_widget_valid(self.log_level_combo):
                for i in range(self.log_level_combo.count()):
                    if self.log_level_combo.itemData(i) == 'info':
                        self.log_level_combo.setCurrentIndex(i)
                        break
                    
            # 保存路径
            if hasattr(self, 'save_path_edit') and self._is_widget_valid(self.save_path_edit):
                self.save_path_edit.setText(os.path.expanduser('~/Documents/ClutUI'))
            
            # 显示重置通知
            main_window = self.window()
            if self._is_widget_valid(main_window) and hasattr(main_window, 'show_notification'):
                main_window.show_notification(
                    text=i18n.get_text("settings_reset"),
                    type=NotificationType.INFO,
                    duration=2000
                )
        except Exception as e:
            log.error(f"重置设置时出错: {str(e)}")
    
    def _on_language_selection_changed(self, index):
        """语言选择改变时的处理"""
        try:
            if not hasattr(self, 'language_combo') or not self._is_widget_valid(self.language_combo):
                return
                
            lang_code = self.language_combo.itemData(index)
            if not lang_code:
                return
                
            # 立即更新语言
            i18n.set_language(lang_code)
            
            # 立即更新标题
            title_label = self.findChild(QLabel, "title_label")
            if self._is_widget_valid(title_label):
                title_label.setText(i18n.get_text("settings"))
            
            # 立即更新所有文本
            self._update_all_texts()
            
            # 发送语言改变信号
            self.language_changed.emit(lang_code)
            
            # 显示语言已更改的通知
            main_window = self.window()
            if self._is_widget_valid(main_window) and hasattr(main_window, 'show_notification'):
                main_window.show_notification(
                    text=i18n.get_text("language_changed").format(self.lang_display[lang_code]),
                    type=NotificationType.INFO,
                    duration=2000
                )
            
            # 保存语言设置到配置文件
            try:
                config = self._load_config()
                config['language'] = lang_code
                self._save_config(config)
            except Exception as e:
                log.error(f"保存语言设置时出错: {str(e)}")
                
        except Exception as e:
            log.error(f"切换语言时出错: {str(e)}")

    def _update_all_texts(self):
        """立即更新所有文本"""
        try:
            # 检查是否已经被销毁
            if not self._is_widget_valid(self):
                return
                
            # 更新背景效果映射
            self.background_effects = {
                "effect_none": i18n.get_text("effect_none", "无效果"),
                "effect_mica": i18n.get_text("effect_mica", "云母效果"),
                "effect_gaussian": i18n.get_text("effect_gaussian", "高斯模糊"),
                "effect_blur": i18n.get_text("effect_blur", "模糊效果"),
                "effect_acrylic": i18n.get_text("effect_acrylic", "亚克力效果"),
                "effect_aero": i18n.get_text("effect_aero", "Aero玻璃效果")
            }
            
            # 更新语言显示映射
            self.lang_display = {
                "zh": i18n.get_text("lang_zh"),
                "en": i18n.get_text("lang_en"),
                "zh_hk": i18n.get_text("lang_zh_hk"),
                "origin": i18n.get_text("lang_origin")
            }
            
            # 立即更新主标题
            title_label = self.findChild(QLabel, "title_label")
            if self._is_widget_valid(title_label):
                title_label.setText(i18n.get_text("settings"))
            
            # 检查并更新各个组件
            if hasattr(self, 'tab_widget') and self._is_widget_valid(self.tab_widget):
                # 立即更新选项卡标题
                self.tab_widget.setTabText(0, i18n.get_text("general"))
                self.tab_widget.setTabText(1, i18n.get_text("appearance"))
                self.tab_widget.setTabText(2, i18n.get_text("advanced"))
                
                # 更新各选项卡文本
                self._update_general_tab_text()
                self._update_appearance_tab_text()
                self._update_advanced_tab_text()
            
            # 处理特殊的下拉框更新
            if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                try:
                    current_data = self.effect_combo.currentData()
                    self.effect_combo.blockSignals(True)
                    self.effect_combo.clear()
                    for effect_code, display_name in self.background_effects.items():
                        self.effect_combo.addItem(display_name, effect_code)
                    if current_data:
                        index = self.effect_combo.findData(current_data)
                        if index >= 0:
                            self.effect_combo.setCurrentIndex(index)
                finally:
                    if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                        self.effect_combo.blockSignals(False)
            
            # 更新按钮文本
            if hasattr(self, 'reset_button') and self._is_widget_valid(self.reset_button):
                self.reset_button.update_title(i18n.get_text("reset"))
            if hasattr(self, 'save_button') and self._is_widget_valid(self.save_button):
                self.save_button.update_title(i18n.get_text("save"))
            
            # 更新语言选择框
            try:
                if not hasattr(self, 'language_combo') or not self._is_widget_valid(self.language_combo):
                    return
                    
                # 保存当前选择的语言
                current_data = None
                try:
                    current_data = self.language_combo.currentData()
                except Exception:
                    pass
                
                # 安全地阻塞信号
                signals_blocked = False
                try:
                    if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                        signals_blocked = self.language_combo.signalsBlocked()
                        self.language_combo.blockSignals(True)
                except Exception as e:
                    log.error(f"阻塞语言选择框信号时出错: {str(e)}")
                    return
                
                try:
                    # 清空并重新添加选项
                    if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                        self.language_combo.clear()
                        
                        # 添加语言选项
                        for lang_code, display_name in self.lang_display.items():
                            if lang_code and display_name:
                                try:
                                    self.language_combo.addItem(display_name, lang_code)
                                except Exception as e:
                                    log.error(f"添加语言选项时出错: {str(e)}")
                                    continue
                        
                        # 恢复之前选择的语言
                        if current_data:
                            try:
                                index = -1
                                for i in range(self.language_combo.count()):
                                    if self.language_combo.itemData(i) == current_data:
                                        index = i
                                        break
                                
                                if index >= 0:
                                    self.language_combo.setCurrentIndex(index)
                            except Exception as e:
                                log.error(f"恢复语言选择时出错: {str(e)}")
                                # 如果恢复失败，尝试设置为默认语言（中文）
                                try:
                                    for i in range(self.language_combo.count()):
                                        if self.language_combo.itemData(i) == 'zh':
                                            self.language_combo.setCurrentIndex(i)
                                            break
                                except Exception:
                                    pass
                finally:
                    # 安全地恢复信号状态
                    try:
                        if hasattr(self, 'language_combo') and self._is_widget_valid(self.language_combo):
                            self.language_combo.blockSignals(signals_blocked)
                    except Exception as e:
                        log.error(f"恢复语言选择框信号状态时出错: {str(e)}")
                        
            except Exception as e:
                log.error(f"更新语言选择框时出错: {str(e)}")
            
            # 强制更新所有选项卡
            if hasattr(self, 'tab_widget') and self._is_widget_valid(self.tab_widget):
                for i in range(self.tab_widget.count()):
                    tab = self.tab_widget.widget(i)
                    if self._is_widget_valid(tab):
                        tab.update()
            
            # 强制更新整个界面
            self.update()
            
        except Exception as e:
            log.error(f"更新所有文本时出错: {str(e)}")
    
    def on_startup_changed(self, state):
        try:
            # 更新注册表
            if getattr(sys, 'frozen', False):
                app_path = sys.executable
            else:
                app_path = os.path.abspath(sys.argv[0])
                
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_WRITE | winreg.KEY_SET_VALUE
            )
            
            try:
                if state:
                    winreg.SetValueEx(
                        key,
                        "ClutUI",
                        0,
                        winreg.REG_SZ,
                        app_path
                    )
                else:
                    try:
                        winreg.DeleteValue(key, "ClutUI")
                    except WindowsError:
                        pass
            finally:
                winreg.CloseKey(key)
                
            # 保存到配置文件
            config = self._load_config()
            config['auto_start'] = bool(state)
            self._save_config(config)
                
        except Exception as e:
            log.error(f"{i18n.get_text('startup_setting_error')}: {str(e)}")
    
    def on_auto_save_changed(self, state):
        try:
            config = self._load_config()
            config['auto_save'] = bool(state)
            self._save_config(config)
        except Exception as e:
            log.error(f"{i18n.get_text('auto_save_error')}: {str(e)}")
    
    def on_bg_effect_changed(self, index):
        """背景效果改变时的处理"""
        effect_code = self.effect_combo.itemData(index)
        if effect_code:
            try:
                config = self._load_config()
                config['background_effect'] = effect_code
                self._save_config(config)
                    
                # 通知主窗口更新背景效果
                main_window = None
                parent = self.parent()
                while parent:
                    if isinstance(parent, QMainWindow):
                        main_window = parent
                        break
                    parent = parent.parent()
                
                if main_window:
                    # 根据效果类型应用不同的效果
                    if effect_code == 'effect_none':
                        PagesEffect.remove_effects(main_window)
                    elif effect_code == 'effect_mica':
                        PagesEffect.apply_mica_effect(main_window)
                    elif effect_code == 'effect_gaussian':
                        PagesEffect.apply_gaussian_blur(main_window)
                    elif effect_code == 'effect_blur':
                        PagesEffect.apply_blur_effect(main_window)
                    elif effect_code == 'effect_acrylic':
                        PagesEffect.apply_acrylic_effect(main_window)
                    elif effect_code == 'effect_aero':
                        PagesEffect.apply_aero_effect(main_window)
                        
            except Exception as e:
                log.error(f"{i18n.get_text('save_config_error')}: {str(e)}")
    
    def _browse_save_path(self):
        current_path = self.save_path_edit.text() or os.path.expanduser('~')
        directory = QFileDialog.getExistingDirectory(
            self,
            i18n.get_text("select_save_path"),
            current_path
        )
        if directory:
            self.save_path_edit.setText(directory)
    
    def _view_logs(self):
        log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs')
        log_dir = os.path.normpath(log_dir)
        
        if os.path.exists(log_dir):
            # 跨平台打开文件夹
            import subprocess
            if os.name == 'nt':  # Windows
                os.startfile(log_dir)
            elif os.name == 'posix':  # macOS 和 Linux
                if 'darwin' in os.sys.platform:  # macOS
                    subprocess.call(['open', log_dir])
                else:  # Linux
                    subprocess.call(['xdg-open', log_dir])
        else:
            # 显示目录不存在通知
            if hasattr(self.window(), 'show_notification'):
                self.window().show_notification(
                    text=i18n.get_text("log_dir_not_found"),
                    type=NotificationType.ERROR,
                    duration=2000
                )
    
    def _update_general_tab_text(self):
        try:
            # 检查 tab_widget 是否有效
            if not hasattr(self, 'tab_widget') or not self._is_widget_valid(self.tab_widget):
                return
                
            # 检查常规选项卡是否有效
            general_tab = self.tab_widget.widget(0)
            if not self._is_widget_valid(general_tab):
                return
            
            # 直接通过objectName查找并更新标签
            # 更新语言设置组
            language_group = general_tab.findChild(QGroupBox, "language_group")
            if self._is_widget_valid(language_group):
                language_group.setTitle(i18n.get_text("language_settings"))
            
            # 更新语言设置描述
            language_desc = general_tab.findChild(QLabel, "language_desc")
            if self._is_widget_valid(language_desc):
                language_desc.setText(i18n.get_text("language_settings_desc"))
            
            # 更新语言标签
            language_label = general_tab.findChild(QLabel, "language_label")
            if self._is_widget_valid(language_label):
                language_label.setText(i18n.get_text("language"))
            
            # 更新启动设置组
            startup_group = general_tab.findChild(QGroupBox, "startup_group")
            if self._is_widget_valid(startup_group):
                startup_group.setTitle(i18n.get_text("auto_start"))
            
            # 更新保存路径组
            save_path_group = general_tab.findChild(QGroupBox, "save_path_group")
            if self._is_widget_valid(save_path_group):
                save_path_group.setTitle(i18n.get_text("save_path"))
            
            # 更新保存路径标签
            save_path_label = general_tab.findChild(QLabel, "save_path_label")
            if self._is_widget_valid(save_path_label):
                save_path_label.setText(i18n.get_text("save_path"))
            
            # 更新浏览按钮
            browse_button = general_tab.findChild(WhiteButton, "browse_button")
            if self._is_widget_valid(browse_button):
                browse_button.update_title(i18n.get_text("browse"))
            
            # 更新开关卡片文本
            if hasattr(self, 'startup_switch') and self._is_widget_valid(self.startup_switch):
                self.startup_switch.update_title(i18n.get_text("auto_start"))
                self.startup_switch.description_label.setText(i18n.get_text("auto_start_desc"))
                self.startup_switch.switch_label.setText(i18n.get_text("auto_start"))
            
            if hasattr(self, 'auto_save_switch') and self._is_widget_valid(self.auto_save_switch):
                self.auto_save_switch.update_title(i18n.get_text("auto_save"))
                self.auto_save_switch.description_label.setText(i18n.get_text("auto_save_desc"))
                self.auto_save_switch.switch_label.setText(i18n.get_text("auto_save"))
            
            # 强制更新界面
            if self._is_widget_valid(general_tab):
                general_tab.update()
                
        except Exception as e:
            log.error(f"更新常规选项卡文本时出错: {str(e)}")
    
    def _update_appearance_tab_text(self):
        try:
            # 检查 tab_widget 是否有效
            if not hasattr(self, 'tab_widget') or not self._is_widget_valid(self.tab_widget):
                return
                
            # 检查外观选项卡是否有效
            appearance_tab = self.tab_widget.widget(1)
            if not self._is_widget_valid(appearance_tab):
                return
            
            # 更新背景效果映射
            self.background_effects = {
                "effect_none": i18n.get_text("effect_none", "无效果"),
                "effect_mica": i18n.get_text("effect_mica", "云母效果"),
                "effect_gaussian": i18n.get_text("effect_gaussian", "高斯模糊"),
                "effect_blur": i18n.get_text("effect_blur", "模糊效果"),
                "effect_acrylic": i18n.get_text("effect_acrylic", "亚克力效果"),
                "effect_aero": i18n.get_text("effect_aero", "Aero玻璃效果")
            }
            
            # 直接通过objectName查找并更新标签
            # 更新效果设置组
            effect_group = appearance_tab.findChild(QGroupBox, "effect_group")
            if self._is_widget_valid(effect_group):
                effect_group.setTitle(i18n.get_text("effect_settings"))
                
            # 更新效果描述
            effect_desc = appearance_tab.findChild(QLabel, "effect_desc")
            if self._is_widget_valid(effect_desc):
                effect_desc.setText(i18n.get_text("effect_settings_desc"))
                
            # 更新效果类型标签
            effect_label = appearance_tab.findChild(QLabel, "effect_label")
            if self._is_widget_valid(effect_label):
                effect_label.setText(i18n.get_text("effect_type"))
                
            # 更新字体设置组
            font_group = appearance_tab.findChild(QGroupBox, "font_group")
            if self._is_widget_valid(font_group):
                font_group.setTitle(i18n.get_text("font_settings"))
                
            # 更新字体描述
            font_desc = appearance_tab.findChild(QLabel, "font_desc")
            if self._is_widget_valid(font_desc):
                font_desc.setText(i18n.get_text("font_settings_desc"))
                
            # 更新字体大小标签
            font_size_label = appearance_tab.findChild(QLabel, "font_size_label")
            if self._is_widget_valid(font_size_label):
                font_size_label.setText(i18n.get_text("font_size"))
            
            # 直接更新效果下拉框
            if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                try:
                    current_data = self.effect_combo.currentData()
                    self.effect_combo.blockSignals(True)
                    self.effect_combo.clear()
                    
                    # 添加效果选项
                    for effect_code, display_name in self.background_effects.items():
                        self.effect_combo.addItem(display_name, effect_code)
                    
                    # 恢复之前选择的效果
                    if current_data:
                        index = self.effect_combo.findData(current_data)
                        if index >= 0:
                            self.effect_combo.setCurrentIndex(index)
                finally:
                    if hasattr(self, 'effect_combo') and self._is_widget_valid(self.effect_combo):
                        self.effect_combo.blockSignals(False)
            
            # 强制更新界面
            if self._is_widget_valid(appearance_tab):
                appearance_tab.update()
            
        except Exception as e:
            log.error(f"更新外观选项卡文本时出错: {str(e)}")
    
    def _update_advanced_tab_text(self):
        try:
            # 检查 tab_widget 是否有效
            if not hasattr(self, 'tab_widget') or not self._is_widget_valid(self.tab_widget):
                return
                
            # 检查高级选项卡是否有效
            advanced_tab = self.tab_widget.widget(2)
            if not self._is_widget_valid(advanced_tab):
                return
            
            # 检查RAM管理器是否有效
            if not hasattr(self, 'ram_manager'):
                return
                
            # 直接通过objectName查找并更新标签
            # 更新RAM设置组
            ram_group = advanced_tab.findChild(QGroupBox, "ram_group")
            if self._is_widget_valid(ram_group):
                ram_group.setTitle(i18n.get_text("ram_settings"))
            
            # 更新RAM设置描述
            ram_desc = advanced_tab.findChild(QLabel, "ram_desc")
            if self._is_widget_valid(ram_desc):
                ram_desc.setText(i18n.get_text("ram_settings_desc"))
            
            # 更新RAM大小标签
            ram_label = advanced_tab.findChild(QLabel, "ram_label")
            if self._is_widget_valid(ram_label):
                ram_label.setText(i18n.get_text("ram_size"))
                
            # 更新系统总内存标签
            system_ram_label = advanced_tab.findChild(QLabel, "system_ram_label")
            if self._is_widget_valid(system_ram_label):
                try:
                    system_ram_label.setText(f"({i18n.get_text('system_total_ram')}: {self.ram_manager.get_system_memory()} MB)")
                except Exception as e:
                    log.error(f"获取系统内存信息失败: {str(e)}")
                    system_ram_label.setText(f"({i18n.get_text('system_total_ram')})")
                
            # 更新已使用和可用内存标签
            if hasattr(self, 'ram_used_label') and self._is_widget_valid(self.ram_used_label):
                try:
                    total_ram = self.ram_manager.get_system_memory()
                    used_ram = self.ram_manager.get_used_ram()
                    
                    # 估算本软件使用的内存（这里假设为50MB，实际应该从系统获取）
                    app_ram = 50  # 假设本软件使用50MB内存
                    
                    # 计算系统其他程序使用的内存
                    other_ram = used_ram - app_ram if used_ram > app_ram else 0
                    
                    self.ram_used_label.setText(f"{i18n.get_text('ram_used')}: {used_ram} MB")
                    
                    # 更新已使用内存进度条
                    if hasattr(self, 'ram_used_progress') and self._is_widget_valid(self.ram_used_progress):
                        # 系统其他程序使用的内存百分比
                        other_percent = min(100, int(other_ram / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_used_progress.setProgress(other_percent)
                        
                        # 本软件使用的内存百分比
                        app_percent = min(100, int(app_ram / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_used_progress.setAppProgress(app_percent)
                        
                        # 设置的RAM值百分比
                        ram_value = self.ram_manager.get_ram_size()  # 使用RAM管理器获取当前RAM值
                        ram_percent = min(100, int(ram_value / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_used_progress.setSecondaryProgress(ram_percent)
                except Exception as e:
                    log.error(f"更新已使用内存信息失败: {str(e)}")
                    
            if hasattr(self, 'ram_available_label') and self._is_widget_valid(self.ram_available_label):
                try:
                    available_ram = self.ram_manager.get_available_ram()
                    self.ram_available_label.setText(f"{i18n.get_text('ram_available')}: {available_ram} MB")
                    
                    # 更新可用内存进度条
                    if hasattr(self, 'ram_available_progress') and self._is_widget_valid(self.ram_available_progress):
                        total_ram = self.ram_manager.get_system_memory()
                        available_percent = min(100, int(available_ram / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_available_progress.setProgress(available_percent)
                except Exception as e:
                    log.error(f"获取可用内存信息失败: {str(e)}")
                    self.ram_available_label.setText(f"{i18n.get_text('ram_available')}: -- MB")
                    if hasattr(self, 'ram_available_progress') and self._is_widget_valid(self.ram_available_progress):
                        self.ram_available_progress.setProgress(0)
            
            # 更新日志设置组
            log_group = advanced_tab.findChild(QGroupBox, "log_group")
            if self._is_widget_valid(log_group):
                log_group.setTitle(i18n.get_text("log_settings"))
            
            # 更新日志级别标签
            log_level_label = advanced_tab.findChild(QLabel, "log_level_label")
            if self._is_widget_valid(log_level_label):
                log_level_label.setText(i18n.get_text("log_level"))
            
            # 更新查看日志按钮
            view_logs_button = advanced_tab.findChild(WhiteButton, "view_logs_button")
            if self._is_widget_valid(view_logs_button):
                view_logs_button.update_title(i18n.get_text("view_logs"))
                
            # 检查combo box是否还存在且有效
            if hasattr(self, 'log_level_combo') and self._is_widget_valid(self.log_level_combo):
                try:
                    # 更新日志级别下拉框
                    self.log_level_combo.blockSignals(True)
                    
                    # 保存当前选择的日志级别
                    current_level = self.log_level_combo.currentData()
                    
                    # 更新所有日志级别选项文本
                    for i in range(self.log_level_combo.count()):
                        level_code = self.log_level_combo.itemData(i)
                        if level_code:
                            display_name = i18n.get_text(f"log_level_{level_code}")
                            self.log_level_combo.setItemText(i, display_name)
                finally:
                    if hasattr(self, 'log_level_combo') and self._is_widget_valid(self.log_level_combo):
                        self.log_level_combo.blockSignals(False)
            
            # 强制更新界面
            if self._is_widget_valid(advanced_tab):
                advanced_tab.update()
                
        except Exception as e:
            log.error(f"更新高级选项卡文本时出错: {str(e)}")
    
    def _on_ram_slider_changed(self, value):
        try:
            # 如果自动RAM设置已启用，不处理滑块变化
            if hasattr(self, 'ram_manager') and self.ram_manager.get_auto_ram():
                return
                
            if hasattr(self, 'ram_value') and self._is_widget_valid(self.ram_value):
                self.ram_value.setText(f"{value} MB")
                
            # 直接保存RAM值到配置文件
            if hasattr(self, 'ram_manager'):
                self.ram_manager.set_ram_size(value)
                # 更新设置字典
                self.settings['launcher_ram'] = value
                
            # 更新系统内存标签
            system_ram_label = self.findChild(QLabel, "system_ram_label")
            if not hasattr(self, 'ram_manager'):
                return
                
            if self._is_widget_valid(system_ram_label):
                try:
                    system_ram_label.setText(f"({i18n.get_text('system_total_ram', '系统总内存')}: {self.ram_manager.get_system_memory()} MB)")
                except Exception as e:
                    log.error(f"获取系统内存信息失败: {str(e)}")
                    system_ram_label.setText(f"({i18n.get_text('system_total_ram', '系统总内存')})")
        except Exception as e:
            log.error(f"更新RAM信息失败: {str(e)}")

    def sizeHint(self):
        return QSize(600, 500)

    def _is_widget_valid(self, widget):
        try:
            if widget is None:
                return False
            if not isinstance(widget, QWidget):
                return False
            # 检查对象是否已被删除
            if getattr(widget, '_deleted', False):
                return False
            # 检查对象是否已被销毁
            if hasattr(widget, 'isDestroyed'):
                return not widget.isDestroyed()
            # 检查对象是否仍然有效
            return bool(widget.objectName() or True)
        except (RuntimeError, AttributeError, Exception):
            return False

    def _update_memory_info(self):
        try:
            if not hasattr(self, 'ram_manager'):
                return
                
            # 如果启用了自动RAM设置，重新计算最佳RAM值
            if self.ram_manager.get_auto_ram():
                optimal_ram = self.ram_manager.calculate_optimal_ram()
                
                # 更新RAM值显示
                if hasattr(self, 'ram_value') and self._is_widget_valid(self.ram_value):
                    self.ram_value.setText(f"{optimal_ram} MB")
                
                # 更新RAM滑块值（不触发valueChanged信号）
                if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider):
                    self.ram_slider.blockSignals(True)
                    self.ram_slider.setValue(optimal_ram)
                    self.ram_slider.blockSignals(False)
                
                # 更新设置字典和RAM管理器中的值（但不保存到配置文件，避免频繁写入）
                if self.settings.get('launcher_ram') != optimal_ram:
                    self.settings['launcher_ram'] = optimal_ram
                    self.ram_manager.settings['launcher_ram'] = optimal_ram
                
            # 更新已使用内存信息和进度条
            if hasattr(self, 'ram_used_label') and self._is_widget_valid(self.ram_used_label):
                try:
                    total_ram = self.ram_manager.get_system_memory()
                    used_ram = self.ram_manager.get_used_ram()
                    
                    # 估算本软件使用的内存（这里假设为50MB，实际应该从系统获取）
                    app_ram = 50  # 假设本软件使用50MB内存
                    
                    # 计算系统其他程序使用的内存
                    other_ram = used_ram - app_ram if used_ram > app_ram else 0
                    
                    self.ram_used_label.setText(f"{i18n.get_text('ram_used')}: {used_ram} MB")
                    
                    # 更新已使用内存进度条
                    if hasattr(self, 'ram_used_progress') and self._is_widget_valid(self.ram_used_progress):
                        # 系统其他程序使用的内存百分比
                        other_percent = min(100, int(other_ram / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_used_progress.setProgress(other_percent)
                        
                        # 本软件使用的内存百分比
                        app_percent = min(100, int(app_ram / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_used_progress.setAppProgress(app_percent)
                        
                        # 设置的RAM值百分比
                        ram_value = self.ram_manager.get_ram_size()  # 使用RAM管理器获取当前RAM值
                        ram_percent = min(100, int(ram_value / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_used_progress.setSecondaryProgress(ram_percent)
                except Exception as e:
                    log.error(f"更新已使用内存信息失败: {str(e)}")
                    
            # 更新可用内存信息和进度条
            if hasattr(self, 'ram_available_label') and self._is_widget_valid(self.ram_available_label):
                try:
                    available_ram = self.ram_manager.get_available_ram()
                    self.ram_available_label.setText(f"{i18n.get_text('ram_available')}: {available_ram} MB")
                    
                    # 更新可用内存进度条
                    if hasattr(self, 'ram_available_progress') and self._is_widget_valid(self.ram_available_progress):
                        total_ram = self.ram_manager.get_system_memory()
                        available_percent = min(100, int(available_ram / total_ram * 100)) if total_ram > 0 else 0
                        self.ram_available_progress.setProgress(available_percent)
                except Exception as e:
                    log.error(f"获取可用内存信息失败: {str(e)}")
                    self.ram_available_label.setText(f"{i18n.get_text('ram_available')}: -- MB")
                    if hasattr(self, 'ram_available_progress') and self._is_widget_valid(self.ram_available_progress):
                        self.ram_available_progress.setProgress(0)
        except Exception as e:
            log.error(f"更新内存信息失败: {str(e)}")

    def on_auto_ram_changed(self, state):
        try:
            if hasattr(self, 'ram_manager'):
                # 设置自动RAM状态
                self.ram_manager.set_auto_ram(bool(state))
                
                # 更新RAM滑块状态
                if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider):
                    self.ram_slider.setEnabled(not bool(state))
                    
                    # 如果启用了自动RAM，更新滑块值为计算出的最佳值
                    if bool(state):
                        optimal_ram = self.ram_manager.calculate_optimal_ram()
                        self.ram_slider.setValue(optimal_ram)
                        if hasattr(self, 'ram_value') and self._is_widget_valid(self.ram_value):
                            self.ram_value.setText(f"{optimal_ram} MB")
                
                # 显示通知
                if hasattr(self.window(), 'show_notification'):
                    if bool(state):
                        self.window().show_notification(
                            text=i18n.get_text("auto_ram_enabled"),
                            type=NotificationType.INFO,
                            duration=2000
                        )
                    else:
                        self.window().show_notification(
                            text=i18n.get_text("auto_ram_disabled"),
                            type=NotificationType.INFO,
                            duration=2000
                        )
        except Exception as e:
            log.error(f"设置自动RAM状态时出错: {str(e)}")

    def _on_ram_value_changed(self, value):
        try:
            # 更新RAM值显示
            if hasattr(self, 'ram_value') and self._is_widget_valid(self.ram_value):
                self.ram_value.setText(f"{value} MB")
                
            # 更新RAM滑块值（不触发valueChanged信号）
            if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider):
                self.ram_slider.blockSignals(True)
                self.ram_slider.setValue(value)
                self.ram_slider.blockSignals(False)
                
            # 更新进度条
            self._update_memory_info()
        except Exception as e:
            log.error(f"更新RAM值显示时出错: {str(e)}")
            
    def _on_auto_ram_state_changed(self, enabled):
        try:
            # 更新自动RAM开关状态（不触发stateChanged信号）
            if hasattr(self, 'auto_ram_switch') and self._is_widget_valid(self.auto_ram_switch):
                self.auto_ram_switch.blockSignals(True)
                self.auto_ram_switch.set_checked(enabled)
                self.auto_ram_switch.blockSignals(False)
                
            # 更新RAM滑块状态
            if hasattr(self, 'ram_slider') and self._is_widget_valid(self.ram_slider):
                self.ram_slider.setEnabled(not enabled)
        except Exception as e:
            log.error(f"更新自动RAM状态显示时出错: {str(e)}")