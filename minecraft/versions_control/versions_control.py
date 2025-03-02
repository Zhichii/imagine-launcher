import os
import json
with open ('config.json','r',encoding='utf-8') as a:
    minecraft = json.load(a)
    minecraft_path = minecraft['save_path']
    minecraft_versions_path = minecraft_path+'\\versions'
    minecraft_versions = []
    versions_info = []
    
    with os.scandir(minecraft_versions_path) as entries:
        for entry in entries:
            if entry.is_dir():
                version_name = entry.name
                minecraft_versions.append(version_name)
                json_path = os.path.join(minecraft_versions_path, version_name, f"{version_name}.json")
                if os.path.exists(json_path):
                    try:
                        with open(json_path,'r',encoding='utf-8') as f:
                            version_data = json.load(f)
                            
                            version_info = {
                                "name": version_name,
                                "type": "vanilla",
                                "loaders": [],
                                "java_version": None,
                                "release_time": version_data.get("releaseTime", None),
                                "arguments": version_data.get("arguments", {}),
                                "main_class": version_data.get("mainClass", None),
                                "base_version": None
                            }
                            
                            # 获取Java版本要求
                            if "javaVersion" in version_data:
                                version_info["java_version"] = version_data["javaVersion"].get("majorVersion", None)
                            
                            # 检查加载器
                            if "libraries" in version_data:
                                libraries = version_data["libraries"]
                                
                                # 检查各种加载器
                                loader_checks = [
                                    {"name": "forge", "keyword": "minecraftforge", "type": "forge"},
                                    {"name": "fabric", "keyword": "fabric-loader", "type": "fabric"},
                                    {"name": "neoforge", "keyword": "neoforge", "type": "neoforge"},
                                    {"name": "quilt", "keyword": "quilt", "type": "quilt"},
                                    {"name": "liteloader", "keyword": "liteloader", "type": "liteloader"},
                                    {"name": "optifine", "keyword": "optifine", "type": None},
                                    {"name": "rift", "keyword": "org.dimdev:rift", "type": "rift"},
                                    {"name": "risugami", "keyword": "risugami", "type": "risugami"}
                                ]
                                
                                for check in loader_checks:
                                    lib = next((lib for lib in libraries if check["keyword"] in lib.get("name", "").lower()), None)
                                    if lib:
                                        if check["type"]:
                                            version_info["type"] = check["type"]
                                        version_info["loaders"].append(check["name"])
                                        
                                        lib_name = lib.get("name", "")
                                        if ":" in lib_name:
                                            version_key = f"{check['name']}_version"
                                            version_info[version_key] = lib_name.split(":")[-1]
                            
                            # 从版本名称检查
                            if not version_info["loaders"]:
                                name_checks = [
                                    {"name": "forge", "keyword": "forge", "not_keyword": "neoforge", "type": "forge"},
                                    {"name": "fabric", "keyword": "fabric", "type": "fabric"},
                                    {"name": "neoforge", "keyword": "neoforge", "type": "neoforge"},
                                    {"name": "quilt", "keyword": "quilt", "type": "quilt"},
                                    {"name": "liteloader", "keyword": "liteloader", "type": "liteloader"},
                                    {"name": "rift", "keyword": "rift", "type": "rift"}
                                ]
                                
                                for check in name_checks:
                                    if check["keyword"] in version_name.lower():
                                        if "not_keyword" in check and check["not_keyword"] in version_name.lower():
                                            continue
                                        version_info["type"] = check["type"]
                                        version_info["loaders"].append(check["name"])
                                
                                # 特殊检查OptiFine
                                if "optifine" in version_name.lower() or "of" in version_name.lower():
                                    version_info["loaders"].append("optifine")
                            
                            # 修复NeoForge和Forge冲突
                            if "neoforge" in version_info["loaders"] and "forge" in version_info["loaders"]:
                                version_info["loaders"].remove("forge")
                                version_info["type"] = "neoforge"
                            
                            # 获取基础版本
                            if "inheritsFrom" in version_data:
                                version_info["base_version"] = version_data["inheritsFrom"]
                            else:
                                version_info["base_version"] = version_data.get("id", version_name)
                            
                            versions_info.append(version_info)
                    except Exception as e:
                        print(f"读取版本 {version_name} 出错: {e}")
                        versions_info.append({
                            "name": version_name, 
                            "type": "unknown", 
                            "loaders": [],
                            "java_version": None,
                            "base_version": None
                        })
                else:
                    versions_info.append({
                        "name": version_name, 
                        "type": "unknown", 
                        "loaders": [],
                        "java_version": None,
                        "base_version": None
                    })
        
        print("所有版本:", minecraft_versions)
        
        for version in versions_info:
            loaders_str = ", ".join(version["loaders"]) if version["loaders"] else "无"
            print(f"版本: {version['name']}, 类型: {version['type']}, 加载器: {loaders_str}, Java: {version['java_version']}")