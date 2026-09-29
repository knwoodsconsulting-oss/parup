INSERT OR IGNORE INTO settings(key,value) VALUES
('profile', '{"barName":"Men in the Kitchen","weekStart":"Monday","distributor":"Southern"}'),
('pourStandards', '{"liquor":1.5,"double":2.25,"wine":6}'),
('defaults', '{"soldAs":"Counted Item","weeklyPar":2,"lowStock":"Below weekly par"}'),
('intelligence', '{"largeFormat":true,"parSuggestions":true,"orderCost":true,"mappingFlags":true}');

INSERT INTO inventory(category,brand,expression,size,unit_cost,open_qty,sealed_qty,weekly_par,sold_as,item_type,large_format_eligible) VALUES
('Tequila','Don Julio','Reposado','750 mL',0,1,3,7,'Both','Liquor',1),
('Tequila','Don Julio','Reposado','375 mL',0,0,1,2,'Whole Bottle','Liquor',0),
('Whiskey','Crown Royal','Apple','750 mL',0,1,2,5,'Both','Liquor',0),
('Whiskey','Crown Royal','Peach','750 mL',0,1,1,5,'Both','Liquor',0),
('Wine','Elmo Pio','Moscato','750 mL',0,1,2,5,'Both','Wine / Champagne',0),
('Tequila','Patrón','Silver','750 mL',0,1,4,7,'Both','Liquor',0),
('Tequila','Casamigos','Blanco','750 mL',0,1,1,2,'Both','Liquor',0),
('Tequila','Casamigos','Reposado','750 mL',0,1,1,2,'Both','Liquor',0),
('Cognac','Hennessy','VS','750 mL',0,2,3,7,'Both','Liquor',1),
('Champagne','Moët & Chandon','Nectar Impérial Rosé','750 mL',72,0,2,2,'Whole Bottle','Wine / Champagne',0),
('Vodka','Tito’s','','750 mL',0,2,4,7,'Both','Liquor',1),
('Wine','Cavit','Pinot Grigio','750 mL',0,1,3,5,'Both','Wine / Champagne',0),
('Tequila','1800','Reposado','750 mL',0,1,2,5,'Pour','Liquor',1),
('Tequila','Cuervo','Especial','750 mL',0,1,2,5,'Pour','Liquor',0),
('Whiskey','Jack Daniel’s','','750 mL',0,1,2,5,'Pour','Liquor',0);
