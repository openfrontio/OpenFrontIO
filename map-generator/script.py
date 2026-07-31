from pathlib import Path
import json

scriptdir = Path(__file__).resolve().parent
assetsdir = scriptdir / "assets" / "maps"
mapfiles = list(assetsdir.rglob("info.json"))



def myFunction(targetCategory):
    matchingFiles = list()
    for info in mapfiles:
        try:
            with open(info, "r", encoding="utf-8") as f:
                lines = json.load(f)
                categories = lines.get("categories", [])
                if targetCategory in categories:
                    matchingFiles.append(f)

                    themes = lines.get("themes", [])
                    if not isinstance(themes, list):
                        themes = []

                    if targetCategory not in themes:
                        themes.append(targetCategory)
                        lines["themes"] = themes

                        with open(info, "w", encoding="utf-8") as f_out:
                            json.dump(lines, f_out, indent=4)
                        print(f"Updated themes in: {info.parent.name}")
                    else:
                        print(f"{targetCategory} already in themes for: {info.parent.name}")
                
        except Exception as e:
            print(f"Error: {e}")

    return matchingFiles

print(myFunction("europe"))



                






